#include <string.h>
#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "oled_ui.h"

#if (OLED_UI_ROTATION == 90 || OLED_UI_ROTATION == 270)
#if OLED_UI_WIDTH != 64 || OLED_UI_HEIGHT != 128
#error "This example requires a physical SSD1306 128x64 display"
#endif
#else
#if OLED_UI_WIDTH != 128 || OLED_UI_HEIGHT != 64
#error "This example requires a physical SSD1306 128x64 display"
#endif
#endif

static const char *TAG = "oled_example";
static i2c_master_dev_handle_t device;
static uint8_t transfer[128];
static size_t transfer_length;
static u8g2_t display;

static uint8_t byte_i2c(u8x8_t *u8x8, uint8_t message, uint8_t count, void *data)
{
    (void)u8x8;
    switch (message) {
    case U8X8_MSG_BYTE_INIT:
    case U8X8_MSG_BYTE_SET_DC:
        return 1;
    case U8X8_MSG_BYTE_START_TRANSFER:
        transfer_length = 0;
        return 1;
    case U8X8_MSG_BYTE_SEND:
        if (count > sizeof(transfer) - transfer_length || (!data && count)) {
            ESP_LOGE(TAG, "Invalid I2C transfer: %u bytes", (unsigned)count);
            ESP_ERROR_CHECK(ESP_ERR_INVALID_SIZE);
            return 0;
        }
        if (count) memcpy(transfer + transfer_length, data, count);
        transfer_length += count;
        return 1;
    case U8X8_MSG_BYTE_END_TRANSFER:
        if (transfer_length)
            ESP_ERROR_CHECK(i2c_master_transmit(device, transfer, transfer_length, 1000));
        return 1;
    default:
        ESP_LOGE(TAG, "Unsupported byte callback: %u", (unsigned)message);
        ESP_ERROR_CHECK(ESP_ERR_NOT_SUPPORTED);
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
        if (count) {
            TickType_t ticks = pdMS_TO_TICKS(count);
            vTaskDelay(ticks ? ticks : 1);
        }
        return 1;
    case U8X8_MSG_DELAY_10MICRO:
        esp_rom_delay_us((uint32_t)count * 10);
        return 1;
    case U8X8_MSG_DELAY_100NANO:
        if (count) esp_rom_delay_us(((uint32_t)count + 9) / 10);
        return 1;
    case U8X8_MSG_DELAY_NANO:
        if (count) esp_rom_delay_us(1);
        return 1;
    default:
        ESP_LOGE(TAG, "Unsupported GPIO/delay callback: %u", (unsigned)message);
        ESP_ERROR_CHECK(ESP_ERR_NOT_SUPPORTED);
        return 0;
    }
}

void app_main(void)
{
    i2c_master_bus_handle_t bus;
    const i2c_master_bus_config_t bus_config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = GPIO_NUM_21,
        .scl_io_num = GPIO_NUM_22,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    const i2c_device_config_t device_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = 0x3C,
        .scl_speed_hz = 100000,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_config, &bus));
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &device_config, &device));
    ESP_ERROR_CHECK(i2c_master_probe(bus, 0x3C, 1000));
    const u8g2_cb_t *rotation = OLED_UI_ROTATION == 90 ? U8G2_R1 :
        OLED_UI_ROTATION == 180 ? U8G2_R2 : OLED_UI_ROTATION == 270 ? U8G2_R3 : U8G2_R0;
#if OLED_UI_FULL_BUFFER
    u8g2_Setup_ssd1306_i2c_128x64_noname_f(&display, rotation, byte_i2c, gpio_delay);
#else
    u8g2_Setup_ssd1306_i2c_128x64_noname_1(&display, rotation, byte_i2c, gpio_delay);
#endif
    u8g2_SetI2CAddress(&display, 0x3C << 1);
    u8g2_InitDisplay(&display);
    u8g2_SetPowerSave(&display, 0);
    unsigned int page = (unsigned int)OLED_UI_DEFAULT_PAGE;
    for (;;) {
#if OLED_UI_FULL_BUFFER
        u8g2_ClearBuffer(&display);
        if (!oled_ui_draw(&display, (OledUiPage)page)) {
            ESP_LOGE(TAG, "Invalid UI page: %u", page);
            ESP_ERROR_CHECK(ESP_ERR_INVALID_ARG);
        }
        u8g2_SendBuffer(&display);
#else
        u8g2_FirstPage(&display);
        do {
            if (!oled_ui_draw(&display, (OledUiPage)page)) {
                ESP_LOGE(TAG, "Invalid UI page: %u", page);
                ESP_ERROR_CHECK(ESP_ERR_INVALID_ARG);
            }
        } while (u8g2_NextPage(&display));
#endif
        page = (page + 1) % OLED_UI_PAGE_COUNT;
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}
