#include "inference_config.h"
#include <cstdlib>
#include <string>
#include <vector>

static void check(bool value) { if (!value) std::abort(); }
static std::optional<InferenceConfig> parse(std::vector<std::string> arguments, int options_start = 3) {
    std::vector<char *> argv;
    for (auto &argument : arguments) argv.push_back(argument.data());
    return inference_config(static_cast<int>(argv.size()), argv.data(), 3, options_start);
}

int main() {
    check(inference_threads(0) == 1);
    check(inference_threads(1) == 1);
    check(inference_threads(2) == 1);
    check(inference_threads(3) == 2);
    check(inference_threads(4) == 3);
    check(inference_threads(8) == 4);
    auto defaults = parse({"engine", "model", "vad"});
    check(defaults && defaults->threads == 2 && !defaults->diagnostics);
    auto measured = parse({"engine", "model", "vad", "--threads=4", "--diagnostics"});
    check(measured && measured->threads == 4 && measured->diagnostics);
    for (const auto &invalid : {"--threads=0", "--threads=17", "--threads=-1", "--threads=", "--threads=2x", "--unknown"}) {
        check(!parse({"engine", "model", "vad", invalid}));
    }
    check(!parse({"engine", "model", "vad", "--threads=2", "--threads=3"}));
    check(!parse({"engine", "model", "vad", "--diagnostics", "--diagnostics"}));
    check(!parse({"engine", "model"}));
    auto streaming = parse({"engine", "/models with spaces/encoder.onnx", "decoder.onnx",
                            "joiner.onnx", "tokens.txt", "vad", "--threads=3", "--diagnostics"}, 6);
    check(streaming && streaming->threads == 3 && streaming->diagnostics);
    check(!parse({"engine", "encoder", "decoder", "joiner", "tokens"}, 6));
    check(!parse({"engine", "encoder", "decoder", "joiner", "tokens", "vad", "--unknown"}, 6));
    check(!parse({"engine", "model", "vad"}, 2));
}
