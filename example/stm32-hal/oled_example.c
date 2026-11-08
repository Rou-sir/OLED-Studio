#include <string.h>
#include "main.h"
#include "oled_ui.h"
#include "oled_example.h"

#if (OLED_UI_ROTATION == 90 || OLED_UI_ROTATION == 270)
#if OLED_UI_WIDTH != 64 || OLED_UI_HEIGHT != 128
#error "This example requires a physical SSD1306 128x64 display"
#endif
#else
#if OLED_UI_WIDTH != 128 || OLED_UI_HEIGHT != 64
#error "This example requires a physical SSD1306 128x64 display"
#endif
#endif

extern I2C_HandleTypeDef hi2c1;
static u8g2_t display;
static uint8_t transfer[128];
static size_t transfer_length;
static int failed;
static int initialized;
static uint32_t last_hal_error;

static uint8_t byte_i2c(u8x8_t *u8x8, uint8_t message, uint8_t count, void *data)
{
    if (failed) return 0;
    switch (message) {
    case U8X8_MSG_BYTE_INIT:
    case U8X8_MSG_BYTE_SET_DC:
        return 1;
    case U8X8_MSG_BYTE_START_TRANSFER:
        transfer_length = 0;
        return 1;
    case U8X8_MSG_BYTE_SEND:
        if (count > sizeof(transfer) - transfer_length || (!data && count)) {
            failed = 1;
            return 0;
        }
        if (count) memcpy(transfer + transfer_length, data, count);
        transfer_length += count;
        return 1;
    case U8X8_MSG_BYTE_END_TRANSFER:
        if (transfer_length && HAL_I2C_Master_Transmit(&hi2c1, u8x8_GetI2CAddress(u8x8),
                transfer, (uint16_t)transfer_length, 1000) != HAL_OK) {
            last_hal_error = HAL_I2C_GetError(&hi2c1);
            failed = 1;
            return 0;
        }
        return 1;
    default:
        failed = 1;
        return 0;
    }
}

static uint8_t gpio_delay(u8x8_t *u8x8, uint8_t message, uint8_t count, void *data)
{
    (void)u8x8;
    (void)data;
    switch (message) {
    case U8X8_MSG_GPIO_AND_DELAY_INIT:
    case U8X8_MSG_GPIO_RESET: /* Four-pin module; reset is not connected. */
        return 1;
    case U8X8_MSG_DELAY_MILLI:
        HAL_Delay(count);
        return 1;
    case U8X8_MSG_DELAY_10MICRO:
    case U8X8_MSG_DELAY_100NANO:
    case U8X8_MSG_DELAY_NANO:
        if (count) HAL_Delay(1); /* Conservative delay; hardware I2C is not bit-banged. */
        return 1;
    default:
        failed = 1;
        return 0;
    }
}

int OLED_Example_Init(void)
{
    failed = 0;
    initialized = 0;
    last_hal_error = 0;
    if (HAL_I2C_IsDeviceReady(&hi2c1, 0x3C << 1, 3, 1000) != HAL_OK) {
        last_hal_error = HAL_I2C_GetError(&hi2c1);
        failed = 1;
        return 0;
    }
    const u8g2_cb_t *rotation = OLED_UI_ROTATION == 90 ? U8G2_R1 :
        OLED_UI_ROTATION == 180 ? U8G2_R2 : OLED_UI_ROTATION == 270 ? U8G2_R3 : U8G2_R0;
#if OLED_UI_FULL_BUFFER
    u8g2_Setup_ssd1306_i2c_128x64_noname_f(&display, rotation, byte_i2c, gpio_delay);
#else
    u8g2_Setup_ssd1306_i2c_128x64_noname_1(&display, rotation, byte_i2c, gpio_delay);
#endif
    u8g2_SetI2CAddress(&display, 0x3C << 1);
    u8g2_InitDisplay(&display);
    if (failed) return 0;
    u8g2_SetPowerSave(&display, 0);
    initialized = !failed;
    return initialized;
}

int OLED_Example_Draw(unsigned int page)
{
    if (!initialized || failed || page >= OLED_UI_PAGE_COUNT) return 0;
#if OLED_UI_FULL_BUFFER
    u8g2_ClearBuffer(&display);
    if (!oled_ui_draw(&display, (OledUiPage)page)) return 0;
    u8g2_SendBuffer(&display);
#else
    u8g2_FirstPage(&display);
    do {
        if (!oled_ui_draw(&display, (OledUiPage)page)) return 0;
    } while (!failed && u8g2_NextPage(&display));
#endif
    return !failed;
}

uint32_t OLED_Example_LastHalError(void)
{
    return last_hal_error;
}
