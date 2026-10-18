#include "ggml.h"
#include "ggml-alloc.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"
#include <cstdio>
#include <memory>

int main() {
    auto backend = std::unique_ptr<ggml_backend, decltype(&ggml_backend_free)>(
        ggml_backend_cpu_init(), ggml_backend_free);
    auto context = std::unique_ptr<ggml_context, decltype(&ggml_free)>(
        ggml_init({1024 * 1024, nullptr, true}), ggml_free);
    if (!backend || !context) return 1;
    auto * left = ggml_new_tensor_2d(context.get(), GGML_TYPE_F32, 128, 32);
    auto * right = ggml_new_tensor_2d(context.get(), GGML_TYPE_F32, 128, 32);
    auto * output = ggml_add(context.get(), left, right);
    auto * graph = ggml_new_graph_custom(context.get(), 32, false);
    ggml_build_forward_expand(graph, output);
    auto buffer = std::unique_ptr<ggml_backend_buffer, decltype(&ggml_backend_buffer_free)>(
        ggml_backend_alloc_ctx_tensors(context.get(), backend.get()), ggml_backend_buffer_free);
    if (!buffer) return 2;
    ggml_set_f32(left, 2.0f);
    ggml_set_f32(right, 3.0f);
    auto correct = [&] {
        for (int i = 0; i < 128 * 32; ++i) {
            if (ggml_get_f32_1d(output, i) != 5.0f) return false;
        }
        return true;
    };
    ggml_backend_cpu_set_n_threads(backend.get(), 2);
    auto free_plan = [&](void * plan) { ggml_backend_graph_plan_free(backend.get(), plan); };
    auto plan = std::unique_ptr<void, decltype(free_plan)>(
        ggml_backend_graph_plan_create(backend.get(), graph), free_plan);
    if (!plan) return 3;
    for (const int threads : {2, 3, 1, 2}) {
        ggml_backend_cpu_set_n_threads(backend.get(), threads);
        for (int i = 0; i < 20; ++i) {
            if (ggml_backend_graph_compute(backend.get(), graph) != GGML_STATUS_SUCCESS || !correct()) return 4;
        }
        // The saved two-thread plan must remain usable after replacing the pool.
        if (ggml_backend_graph_plan_compute(backend.get(), plan.get()) != GGML_STATUS_SUCCESS || !correct()) return 5;
    }
    auto params = ggml_threadpool_params_default(3);
    params.poll = 0;
    auto external = std::unique_ptr<ggml_threadpool, decltype(&ggml_threadpool_free)>(
        ggml_threadpool_new(&params), ggml_threadpool_free);
    if (!external) return 6;
    ggml_backend_cpu_set_threadpool(backend.get(), external.get());
    if (ggml_backend_graph_compute(backend.get(), graph) != GGML_STATUS_SUCCESS || !correct()) return 7;
    ggml_backend_cpu_set_threadpool(backend.get(), nullptr);
    external.reset();
    if (ggml_backend_graph_compute(backend.get(), graph) != GGML_STATUS_SUCCESS || !correct()) return 8;
    std::puts("CPU pool reuse, thread-count changes, cached plans and external ownership passed");
    return 0;
}
