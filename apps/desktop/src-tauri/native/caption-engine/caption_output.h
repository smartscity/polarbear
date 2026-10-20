#pragma once

#include "json.hpp"

void emit(const nlohmann::ordered_json &event);
void phase(const char *name);
void metric(const nlohmann::ordered_json &value);
