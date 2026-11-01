# Mudelite litsentsid (kontrollitud 2026-11-01)

Kolm mudelit, mida Kõneväli kasutab või võib kasutada. **See ei ole juriidiline nõu**: kontrolli põhines nende mudelite litsentsiväljadel ja allikalehtedel, mitte juristi hinnangul.

| Mudel | Litsents | Lubab hostimist teenuses | Vajab atribuutikat | Vajab allika viitamist |
|---|---|---|---|---|
| **TalTech** `streaming-zipformer-large.et-en.w2n` (kõnetuvastus) | **Apache-2.0** | Jah | Teenusena hostides ei, kui faile **levitatakse** edasi, siis jah (litsentsi tekst, teated, muudatused) | Mudelikaart ei nõua; soovitus viidata |
| **TitaNet-small** (NVIDIA NeMo; fail `nemo_en_titanet_small.onnx`, ONNX-i teisendus sherpa-onnx'ist) | **Apache-2.0** (NGC mudelikaardi järgi kehtib NeMo Toolkit'i litsents) | Jah | Nagu eespool | Mudelikaart ei nõua; soovitus viidata NVIDIA NeMo-le ja sherpa-onnx'ile |
| **3D-Speaker CAM++** (`iic/speech_campplus_sv_zh_en_16k-common_advanced`; vaikimisi **ei** kasutata) | **Apache-2.0** | Jah | Nagu eespool | README **palub** viidata artiklile (ei ole nõue) |

**Deploy-blokeerijat litsentsidest ei ole:** ükski kolmest ei keela hostimist teenuses.

## Mida iga kontroll põhines

### 1. TalTechNLP kõnetuvastusmudel
- Hugging Face'i mudelikaardi YAML: `license: apache-2.0` ([w2n](https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en.w2n)). Samasisuline mudel ilma numbrite teisenduseta ([streaming-zipformer.et-en](https://huggingface.co/TalTechNLP/streaming-zipformer.et-en)) on kaardil **MIT**. Kasutame w2n varianti, seega kehtib Apache-2.0.
- Mudelikaart ei esita lisanõudeid ega kasutuspiiranguid. Repos puudub eraldi LICENSE/NOTICE fail.
- Mudeli koolitusandmed (TalTechi eesti kõneandmestik, automaatselt transkribeeritud avalik TV, Gigaspeech'i 500 h alamhulk) ja nende endi tingimused **ei ole siin kontrollitud**. Need on mudeli litsentsist eraldi küsimus.

### 2. TitaNet-small (NeMo)
- NVIDIA NGC mudelikaart ([titanet_small](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/titanet_small)) ütleb: mudeli kasutamise litsents on NeMo Toolkit'i litsents. NeMo Toolkit on [Apache-2.0](https://raw.githubusercontent.com/NVIDIA/NeMo/main/LICENSE).
- **Ettevaatus:** suurem vend [titanet_large Hugging Face'is on CC-BY-4.0](https://huggingface.co/api/models/nvidia/speakerverification_en_titanet_large) (see nõuab viitamist). Meie kasutatav *small* on NGC kaardi järgi NeMo litsentsi all. Kasutatav fail on kolmanda osapoole (k2-fsa/sherpa-onnx) ONNX-teisendus, mille kohta eraldi litsentsiteksti ei leidnud. Usaldustase: keskmine. Kui NVIDIA muudaks seisukohta CC-BY-ks, tuleks viidata; viitamine on igal juhul tasuta kindlustus.

### 3. 3D-Speaker CAM++
- ModelScope'i mudeli andmed: litsents **Apache License 2.0** ([API](https://modelscope.cn/api/v1/models/iic/speech_campplus_sv_zh_en_16k-common_advanced)); repo [LICENSE](https://raw.githubusercontent.com/modelscope/3D-Speaker/main/LICENSE) on samuti Apache-2.0.
- README palub viitamist, kui mudel aitas (artikkel), mitte nõue.

## Mida Apache-2.0 praktikas tähendab siin

- **Kasutamine ja hostimine (sh kaubanduslik) on lubatud.** Ehitusel laaditud failid on privaatses Dockeri kujutises Railwayl ja nende mudelite koopiaid kolmandatele ei anta. Seda ei loeta levitamiseks.
- **Levitamise** korral (nt avalik Dockeri kujutis, failide jagamine) tuleb kaasa anda Apache-2.0 tekst, säilitada autoriõiguse ja NOTICE teated ning märkida muudatused (nt ONNX-teisendus).
- Nime ja kaubamärke see ei anna: ei tohi väita, et TalTech, NVIDIA või Alibaba/ModelScope soovitab Kõnevälja.

## Soovitus (mitte blokeerija)

Lisa enne piloodi teiste inimestega **lühike "Kasutatud mudelid" rida** privaatsuslehele või README-sse: TalTechNLP kõnetuvastus (Apache-2.0), NVIDIA NeMo TitaNet-small (sherpa-onnx ONNX-teisendus, Apache-2.0). See on hea tava ja kaitseb, kui ükskõik milline litsents osutub tähelepanelikumaks.

## Mida ei ole kontrollitud

- Kõigi kolme mudeli **koolitusandmete** õigused.
- NVIDIA kaardi väide kehtib ka sherpa-onnx'i ONNX-teisendusele (usaldus keskmine).
- Juriidilist hinnangut ei ole küsitud.
