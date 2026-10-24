use std::{
    fs::{File, OpenOptions},
    io::{self, Seek, SeekFrom, Write},
    path::Path,
};

// Two hours of 16 kHz mono float32 PCM per capture epoch; never an unbounded recording.
const MAX_AUDIO_BYTES: u32 = 2 * 60 * 60 * 16000 * 4;

pub(super) struct WavRecording<W: Write + Seek> {
    output: W,
    bytes: u32,
    checkpoint: u32,
}

impl WavRecording<File> {
    pub fn create(path: &Path) -> io::Result<Self> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        Self::new(options.open(path)?)
    }
}

impl<W: Write + Seek> WavRecording<W> {
    fn new(output: W) -> io::Result<Self> {
        let mut recording = Self {
            output,
            bytes: 0,
            checkpoint: 0,
        };
        recording.finish()?;
        Ok(recording)
    }

    pub fn append(&mut self, samples: &[f32]) -> io::Result<()> {
        let size = u32::try_from(samples.len())
            .ok()
            .and_then(|count| count.checked_mul(4))
            .and_then(|size| self.bytes.checked_add(size))
            .filter(|size| *size <= MAX_AUDIO_BYTES)
            .ok_or_else(|| io::Error::other("Diagnostic recording limit reached"))?;
        let data: Vec<_> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        self.output.write_all(&data)?;
        self.bytes = size;
        // Checkpoint once a second so an interrupted file retains a readable prefix.
        if self.bytes - self.checkpoint >= 16000 * 4 {
            self.finish()?;
        }
        Ok(())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        let mut header = Vec::with_capacity(44);
        header.extend_from_slice(b"RIFF");
        header.extend_from_slice(&(36 + self.bytes).to_le_bytes());
        header.extend_from_slice(b"WAVEfmt ");
        header.extend_from_slice(&16_u32.to_le_bytes());
        header.extend_from_slice(&3_u16.to_le_bytes());
        header.extend_from_slice(&1_u16.to_le_bytes());
        header.extend_from_slice(&16000_u32.to_le_bytes());
        header.extend_from_slice(&64000_u32.to_le_bytes());
        header.extend_from_slice(&4_u16.to_le_bytes());
        header.extend_from_slice(&32_u16.to_le_bytes());
        header.extend_from_slice(b"data");
        header.extend_from_slice(&self.bytes.to_le_bytes());
        self.output.seek(SeekFrom::Start(0))?;
        self.output.write_all(&header)?;
        self.output.flush()?;
        self.output
            .seek(SeekFrom::Start(44 + u64::from(self.bytes)))?;
        self.checkpoint = self.bytes;
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn records_exact_recognizer_samples_as_a_float_wav() {
        let mut recording = WavRecording::new(Cursor::new(Vec::new())).unwrap();
        recording.append(&[0.0, 0.25, -0.5]).unwrap();
        recording.finish().unwrap();
        let bytes = recording.output.get_ref();
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(u16::from_le_bytes(bytes[20..22].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 16000);
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 12);
        assert_eq!(
            &bytes[44..],
            &[0.0_f32, 0.25, -0.5]
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn bounds_recordings_without_silently_overwriting_audio() {
        let mut recording = WavRecording::new(Cursor::new(Vec::new())).unwrap();
        recording.bytes = MAX_AUDIO_BYTES;
        assert!(recording.append(&[0.25]).is_err());
        assert_eq!(recording.bytes, MAX_AUDIO_BYTES);
    }

    #[test]
    fn creates_private_files_and_never_overwrites_an_existing_recording() {
        let path =
            std::env::temp_dir().join(format!("polarbear-caption-{}.wav", uuid::Uuid::new_v4()));
        let mut recording = WavRecording::create(&path).unwrap();
        recording.append(&[0.25; 512]).unwrap();
        recording.finish().unwrap();
        drop(recording);
        let before = std::fs::read(&path).unwrap();
        assert!(WavRecording::create(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(before.len(), 44 + 512 * 4);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_file(path).unwrap();
    }
}
