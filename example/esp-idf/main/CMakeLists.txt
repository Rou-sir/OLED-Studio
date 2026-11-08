idf_component_register(SRCS "main.c"
                       INCLUDE_DIRS "."
                       REQUIRES oled_ui driver esp_rom freertos)
