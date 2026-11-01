# Kõnevälja kasutatavad mudelid ja nende litsentsid

Eesmärk on arusaadav tehniline dokumentatsioon: mis mudelit kasutatakse, mis versioon ja allikas, mis litsents ning miks. Kontrollitud 2026-11-01. **See ei ole juriidiline nõu.**

## Ülevaade

| Mudel | Roll Kõnevälja | Litsents | Hostimine teenuses |
|---|---|---|---|
| **TalTechNLP streaming-zipformer-large.et-en.w2n** | Reaalajas kõnetuvastus (eesti keel) | Apache-2.0 | Jah |
| **TitaNet-small** (NVIDIA NeMo) | Valikuline sessioonipõhine kõneleja nimetamine | Apache-2.0 (NeMo litsents) | Jah |
| **3D-Speaker CAM++** | Alternatiivne kõnelejatuvastuse mudel (praegu ei kasutata) | Apache-2.0 | Jah |

**Deploy-blokeerijat litsentsidest ei ole:** ükski kolmest ei keela hostimist teenuses.

## 1. TalTechNLP streaming-zipformer-large.et-en.w2n

- **Roll:** reaalajas kõnetuvastus. See on Kõnevälja põhimudel: mikrofoni heli muutub selle abil tekstiks. Eesti keel, inglise terminitega; numbrid kirjutatakse numbritena (".w2n" = words to numbers).
- **Tüüp:** icefall/k2 Zipformer-teisendaja (transducer), voogedastav, ONNX-vormingus (`encoder.onnx`, `decoder.onnx`, `joiner.onnx`, `tokens.txt`), jookseb sherpa-onnx'iga (greedy search, kõnetuvastusaken 8 s).
- **Allikas ja versioon:** Hugging Face [`TalTechNLP/streaming-zipformer-large.et-en.w2n`](https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en.w2n), commit `82d23225b01ff8962847d95dd30234f1e737b724`. Kasutatakse täistäpsust (fp32, kokku 598 MB). int8 variandid on olemas, aga me ei ole neid mõõtnud.
- **Kontroll:** `tools/fetch-models.py` kinnitab iga faili suuruse ja SHA-256 (`encoder.onnx` 592 970 112 B, `3a9bd002…`).
- **Litsents:** **Apache-2.0** (mudelikaardi YAML). Samasisuline mudel ilma numbrite teisenduseta (`streaming-zipformer-large.et-en`) on kaardil MIT; me kasutame w2n varianti.
- **Hostimine:** jah. **Atribuutika:** teenusena hostides ei nõuta; failide levitamisel jah. **Allika viitamine:** mudelikaart ei nõua, soovitus viidata.
- **Märkus:** koolitusandmete (TalTechi eesti kõneandmestik, automaatselt transkribeeritud avalik TV, Gigaspeech'i alamhulk) õigusi ei ole kontrollitud.

## 2. TitaNet-small (NVIDIA NeMo)

- **Roll:** valikuline sessioonipõhine kõneleja nimetamine. Häälenäitest tehakse arvuline häälejälg, mille põhjal server otsustab, kelle hääl lause on. Ilma selleta (nimeta kasutus) seda mudelit ei kasutata. Vaikimisi mudel serveri Dockeris, lävi 0,33.
- **Tüüp:** kõneleja embedding'u mudel (TitaNet-S), ONNX-vormingus, jookseb sherpa-onnx'i `SpeakerEmbeddingExtractor`'iga. NeMo teeki ei ole vaja.
- **Allikas ja versioon:** NVIDIA NGC [`nvidia/nemo/titanet_small`](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/titanet_small) (v1.19.0, 2023-06). Fail `nemo_en_titanet_small.onnx` on k2-fsa/sherpa-onnx'i ONNX-teisendus, release `speaker-recongition-models` (40 257 283 B, SHA-256 `ad4a1802…`).
- **Litsents:** **Apache-2.0**. NGC mudelikaardi järgi kehtib mudelile NeMo Toolkit'i litsents ([Apache-2.0](https://raw.githubusercontent.com/NVIDIA/NeMo/main/LICENSE)). Kolmanda osapoole ONNX-teisendusele eraldi litsentsiteksti ei leidnud (usaldus keskmine).
- **Ettevaatus:** NVIDIA suurem [`titanet_large` on Hugging Face'is CC-BY-4.0](https://huggingface.co/api/models/nvidia/speakerverification_en_titanet_large) (nõuab viitamist). *Small* on teistsugune ja viitab NeMo litsentsile.
- **Hostimine:** jah. **Atribuutika:** nagu eespool. **Allika viitamine:** ei nõuta, soovitan (NVIDIA NeMo, sherpa-onnx).

## 3. 3D-Speaker CAM++

- **Roll:** alternatiivne kõnelejatuvastuse mudel. Server toetab seda (`--speaker-model`, lävi 0,36), aga **praegu ei kasutata**, sest nimede live-katsed tehti TitaNet-small'iga. Meie sisemises salvestuste võrdluses oli selle EER madalaim, seega on see mõistlik asendaja, kui vaja.
- **Tüüp:** CAM++ kõneleja embedding'u mudel, ONNX-vormingus.
- **Allikas ja versioon:** ModelScope [`iic/speech_campplus_sv_zh_en_16k-common_advanced`](https://modelscope.cn/api/v1/models/iic/speech_campplus_sv_zh_en_16k-common_advanced), sherpa-onnx'i ONNX-teisendus, sama release. Fail `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` (28 281 164 B, SHA-256 `aa3cfc16…`). Koolitatud hiina ja inglise andmetel (mitte eesti keeles).
- **Litsents:** **Apache-2.0** (ModelScope'i mudeli andmed; repo [LICENSE](https://raw.githubusercontent.com/modelscope/3D-Speaker/main/LICENSE) samuti).
- **Hostimine:** jah. **Atribuutika:** nagu eespool. **Allika viitamine:** README **palub** viidata artiklile, mitte nõue.

## Mida Apache-2.0 praktikas tähendab siin

- **Kasutamine ja hostimine (sh kaubanduslik) on lubatud.** Ehitusel laaditud failid on privaatses Dockeri kujutises Railwayl ja nende koopiaid kolmandatele ei anta. Seda ei loeta levitamiseks.
- **Levitamise** korral (nt avalik Dockeri kujutis, failide jagamine) tuleb kaasa anda Apache-2.0 tekst, säilitada autoriõiguse ja NOTICE teated ning märkida muudatused (nt ONNX-teisendus).
- See ei anna õigust kasutada TalTechi, NVIDIA või Alibaba/ModelScope nime nii, nagu nad Kõnevälja soovitaksid.

## Soovitus (mitte blokeerija)

Lisa enne piloodi teiste inimestega **lühike "Kasutatud mudelid" rida** privaatsuslehele või README-sse: TalTechNLP kõnetuvastus (Apache-2.0), NVIDIA NeMo TitaNet-small (sherpa-onnx ONNX-teisendus, Apache-2.0). See on hea tava ja kaitseb, kui litsentside tõlgendus osutub täpsemaks.

## Mida ei ole kontrollitud

- Kõigi kolme mudeli **koolitusandmete** õigused.
- Kas NVIDIA kaardi väide kehtib ka sherpa-onnx'i ONNX-teisendusele.
- Juriidilist hinnangut ei ole küsitud.
