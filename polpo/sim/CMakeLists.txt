# Polpo — simulatore: il firmware vero (polpo/src) compilato fuori dal dispositivo.
#
#   Prove sul PC:      cmake -S polpo/sim -B build/sim -G Ninja && cmake --build build/sim && ctest --test-dir build/sim
#   Per il browser:    emcmake cmake -S polpo/sim -B build/web -G Ninja -DCMAKE_BUILD_TYPE=MinSizeRel && cmake --build build/web
#
# Le librerie (M5GFX, ArduinoJson, rc-switch) sono quelle fissate in platformio.ini: si scaricano con
#   pio pkg install -d polpo -e cardputer
cmake_minimum_required(VERSION 3.20)
project(polpo_sim LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

set(POLPO "${CMAKE_CURRENT_SOURCE_DIR}/..")
set(POLPO_LIBDEPS "${POLPO}/.pio/libdeps/cardputer" CACHE PATH "Librerie scaricate da PlatformIO")
foreach(lib M5GFX ArduinoJson rc-switch)
  if(NOT EXISTS "${POLPO_LIBDEPS}/${lib}")
    message(FATAL_ERROR "Manca ${POLPO_LIBDEPS}/${lib}: esegui «pio pkg install -d polpo -e cardputer» (o indica -DPOLPO_LIBDEPS=...)")
  endif()
endforeach()
set(M5GFX "${POLPO_LIBDEPS}/M5GFX/src")

find_package(Python3 REQUIRED COMPONENTS Interpreter)
file(STRINGS "${POLPO}/scripts/version.py" riga_versione REGEX "^VERSION = ")
string(REGEX REPLACE ".*\"(.*)\".*" "\\1" POLPO_VERSIONE "${riga_versione}")
message(STATUS "Polpo ${POLPO_VERSIONE}")

# I file d'esempio che sul dispositivo arrivano dal linker.
set(INCORPORATI "${CMAKE_CURRENT_BINARY_DIR}/incorporati.cpp")
add_custom_command(
  OUTPUT "${INCORPORATI}"
  COMMAND Python3::Interpreter "${CMAKE_CURRENT_SOURCE_DIR}/scripts/incorpora.py" "${POLPO}" "${INCORPORATI}"
  DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/scripts/incorpora.py" "${POLPO}/platformio.ini"
  VERBATIM)

# --- il firmware vero: tutto src/ tranne il Bluetooth, più la libreria di logica pura ---
file(GLOB_RECURSE FIRMWARE CONFIGURE_DEPENDS "${POLPO}/src/*.cpp")
list(REMOVE_ITEM FIRMWARE "${POLPO}/src/hal/ble.cpp")
file(GLOB_RECURSE NUCLEO_PURO CONFIGURE_DEPENDS "${POLPO}/lib/polpo_core/src/*.cpp")

# --- librerie vere ---
set(LIBRERIE
  "${POLPO_LIBDEPS}/rc-switch/RCSwitch.cpp"
  "${M5GFX}/lgfx/utility/lgfx_pngle.c" "${M5GFX}/lgfx/utility/lgfx_tjpgd.c" "${M5GFX}/lgfx/utility/lgfx_qoi.c"
  "${M5GFX}/lgfx/utility/lgfx_miniz.c" "${M5GFX}/lgfx/utility/lgfx_qrcode.c"
  "${M5GFX}/lgfx/Fonts/efont/lgfx_efont_cn.c")

# --- la finta piattaforma e il mondo simulato ---
set(SIMULATORE
  platform/piattaforma.cpp mondo.cpp hal/ble.cpp host/sim.cpp lgfx/lgfx_tutto.cpp "${INCORPORATI}")

add_library(polpo_sim STATIC ${FIRMWARE} ${NUCLEO_PURO} ${LIBRERIE} ${SIMULATORE})
target_include_directories(polpo_sim PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/platform"   # prima di tutto: sostituisce Arduino.h, M5Cardputer.h, SD.h...
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${POLPO}/src" "${POLPO}/include" "${POLPO}/lib/polpo_core/src"
  "${M5GFX}" "${POLPO_LIBDEPS}/ArduinoJson/src" "${POLPO_LIBDEPS}/rc-switch")
target_compile_definitions(polpo_sim PUBLIC
  LGFX_LINUX_FB POLPO_FIRMWARE=1 POLPO_SIMULATORE=1 ARDUINO_USB_MODE=0
  "POLPO_VERSION=\"${POLPO_VERSIONE}\"" "POLPO_GIT=\"simulatore\"")
target_compile_options(polpo_sim PRIVATE -ffunction-sections -fdata-sections)
# Le librerie esterne si compilano così come sono: niente avvisi e niente controlli di memoria su di loro
# (i controlli terrebbero in vita anche i caratteri che non usiamo, e i loro dati non sono compilati).
set_source_files_properties(${LIBRERIE} lgfx/lgfx_tutto.cpp PROPERTIES COMPILE_OPTIONS "-w;-fno-sanitize=all")
# rc-switch usa memcpy_P, che fuori da AVR/ESP non esiste: qui è la normale memcpy.
set_source_files_properties("${POLPO_LIBDEPS}/rc-switch/RCSwitch.cpp" PROPERTIES COMPILE_DEFINITIONS "memcpy_P=memcpy")

if(EMSCRIPTEN)
  # Un modulo WebAssembly "nudo": niente codice JavaScript generato, solo le funzioni di host/sim.h.
  add_executable(polpo-sim host/sim.cpp)
  target_link_libraries(polpo-sim PRIVATE polpo_sim)
  set_target_properties(polpo-sim PROPERTIES SUFFIX ".wasm")
  target_link_options(polpo-sim PRIVATE
    -sSTANDALONE_WASM --no-entry -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=8MB -sSTACK_SIZE=1MB -Wl,--gc-sections
    "-sEXPORTED_FUNCTIONS=_sim_avvia,_sim_avanza,_sim_ora,_sim_tasto,_sim_g0,_sim_schermo,_sim_impronta_schermo,_sim_mondo,_sim_evento,_sim_seriale_scrivi,_sim_seriale_leggi,_sim_stato_esporta,_sim_stato_importa,_sim_alloca,_sim_libera")
else()
  option(POLPO_SIM_CONTROLLI "Controlli di memoria (AddressSanitizer, UBSan)" ON)
  if(POLPO_SIM_CONTROLLI)
    target_compile_options(polpo_sim PUBLIC -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(polpo_sim PUBLIC -fsanitize=address,undefined)
  endif()
  add_executable(polpo_host host/polpo_host.cpp)
  target_link_libraries(polpo_host PRIVATE polpo_sim)
  target_link_options(polpo_host PRIVATE -Wl,--gc-sections)

  enable_testing()
  file(GLOB COPIONI CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/tests/*.copione")
  foreach(copione ${COPIONI})
    get_filename_component(nome "${copione}" NAME_WE)
    add_test(NAME ${nome}
      COMMAND Python3::Interpreter "${CMAKE_CURRENT_SOURCE_DIR}/tests/confronta.py" $<TARGET_FILE:polpo_host> "${copione}")
  endforeach()
endif()
