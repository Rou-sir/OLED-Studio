idf_component_register(SRCS "oled_ui.c" "oled_resources.c"
                       INCLUDE_DIRS "."
                       REQUIRES u8g2)
# The separate u8g2 component must use U8G2_16BIT too.
target_compile_definitions(${COMPONENT_LIB} PUBLIC U8G2_16BIT)
