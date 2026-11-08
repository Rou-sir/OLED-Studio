#ifndef OLED_EXAMPLE_H
#define OLED_EXAMPLE_H
#include <stdint.h>

/* Call after HAL, clocks, GPIO and hi2c1 initialization. Returns 0 on failure. */
int OLED_Example_Init(void);
int OLED_Example_Draw(unsigned int page);
uint32_t OLED_Example_LastHalError(void);
#endif
