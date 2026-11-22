#include "core/samples.h"

// Simboli creati da board_build.embed_txtfiles (vedi platformio.ini).
#define POLPO_EMBED(sym) extern const char sym[] asm("_binary_" #sym "_start")

POLPO_EMBED(sd_template_polpo_LEGGIMI_txt);
POLPO_EMBED(sd_template_polpo_badusb_ciao_windows_txt);
POLPO_EMBED(sd_template_polpo_badusb_ciao_mac_txt);
POLPO_EMBED(sd_template_polpo_badusb_ciao_linux_txt);
POLPO_EMBED(sd_template_polpo_ir_esempio_tv_ir);
POLPO_EMBED(sd_template_polpo_script_pallina_polpo);
POLPO_EMBED(sd_template_polpo_script_indovina_polpo);
POLPO_EMBED(sd_template_polpo_script_dado_polpo);
POLPO_EMBED(sd_template_polpo_script_serpente_polpo);

namespace samples {

const std::vector<Sample>& all() {
    static const std::vector<Sample> list = {
        {"/polpo/LEGGIMI.txt", sd_template_polpo_LEGGIMI_txt},
        {"/polpo/badusb/ciao_windows.txt", sd_template_polpo_badusb_ciao_windows_txt},
        {"/polpo/badusb/ciao_mac.txt", sd_template_polpo_badusb_ciao_mac_txt},
        {"/polpo/badusb/ciao_linux.txt", sd_template_polpo_badusb_ciao_linux_txt},
        {"/polpo/ir/esempio_tv.ir", sd_template_polpo_ir_esempio_tv_ir},
        {"/polpo/script/pallina.polpo", sd_template_polpo_script_pallina_polpo},
        {"/polpo/script/indovina.polpo", sd_template_polpo_script_indovina_polpo},
        {"/polpo/script/dado.polpo", sd_template_polpo_script_dado_polpo},
        {"/polpo/script/serpente.polpo", sd_template_polpo_script_serpente_polpo},
    };
    return list;
}

}  // namespace samples
