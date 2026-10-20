#pragma once

#include "inference_config.h"

int run_streaming(const char *model_directory, const char *vad_file, const InferenceConfig &config);
