#pragma once

#include "inference_config.h"
#include "streaming_recognizer.h"

int run_streaming(const StreamingRecognizerConfig &model, const char *vad_file, const InferenceConfig &config);
