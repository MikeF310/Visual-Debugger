# Compilers
HOST_GCC   := g++
TARGET_GCC := gcc

# Sources
PLUGIN_SRC  := memlog_plugin.cc
RUNTIME_SRC := memlog_runtime.c
TARGET_SRC  := plugin_example.c

# GCC plugin include dir
GCC_PLUGINS_DIR := $(shell $(TARGET_GCC) -print-file-name=plugin)
PLUGIN_INC      := $(GCC_PLUGINS_DIR)/include

# Flags
CXXFLAGS += -I$(PLUGIN_INC) -fPIC -fno-rtti -fno-exceptions -std=gnu++17
LDFLAGS_PLUGIN := -shared
CFLAGS  += -g -O0
# If you want runtime output flushed etc you can add -D flags here

.PHONY: all clean test run

all: memlog_plugin.so memlog_runtime.o

# Build the plugin shared object
memlog_plugin.so: $(PLUGIN_SRC)
	$(HOST_GCC) $(LDFLAGS_PLUGIN) $(CXXFLAGS) $< -o $@

# Build runtime object that the injected calls resolve to
memlog_runtime.o: $(RUNTIME_SRC)
	$(TARGET_GCC) -c $(CFLAGS) $< -o $@

# Build the instrumented program (this is where the plugin runs)
a.out: $(TARGET_SRC) memlog_runtime.o memlog_plugin.so
	$(TARGET_GCC) $(CFLAGS) -fplugin=$(CURDIR)/memlog_plugin.so $(TARGET_SRC) memlog_runtime.o -o $@

test: a.out

run: a.out
	./a.out

clean:
	rm -f memlog_plugin.so memlog_runtime.o a.out