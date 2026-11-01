# Kõneväli Railwayl: pilootversioon

Kaks teenust ühes Railway projektis: **live** (Python, kõnetuvastus) ja **web** (leht). Ainult pilootkatseks: mitte avalik teenus.

Nimed on **valikulised ja sessioonipõhised**: häälejäljed elavad ainult ühe ühenduse serverimälus ja kustuvad, kui nimed lülitatakse välja, profiil eemaldatakse või ühendus sulgub. Nimed on saadaval ainult siis, kui live-teenusel on `SPEAKER_MODEL`. Server keeldub avalikul aadressil käivitumast ilma `KONEVALI_TOKEN`-ita ning `--verbose`'iga ja rosterifaili (`--roster`) enam ei tunne.

## Enne alustamist (otsused ja kontrollid)

- Vali Railwayl **EU piirkond** (mõlemale teenusele) ning kirjuta teksti tegelik piirkond ja ettevõte muutujasse `VITE_HOSTING`. Railway on USA ettevõte: ära kirjuta "EL-is", kui seda pole kontrollitud.
- Loe läbi ja aktsepteeri Railway andmetöötluse tingimused (DPA).
- Kontrolli kõnetuvastusmudeli (TalTech `streaming-zipformer-large.et-en.w2n`) litsentsi: kas seda tohib teenuses hostida.
- Pane kirja kontakt (`VITE_CONTACT`): kes vastutab ja kelle poole pöörduda.

## 1. Live-server

- Teenus ehitatakse failist `tools/live.Dockerfile` (muutuja `RAILWAY_DOCKERFILE_PATH=tools/live.Dockerfile`). Ehituse kontekst on repo juur.
- **Mudel ei ole pildis.** Pane mudelikaust (encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt, ~600 MB) teenusele ühendatud köitele (*volume*), nt `/models`. Kuidas mudel köitele jõuab, ei ole veel kokku lepitud (vt "Lahtised sammud").
- Muutujad:

| Muutuja | Väärtus |
|---|---|
| `MODEL_DIR` | `/models/streaming-zipformer-large.et-en.w2n` |
| `WEB_ORIGIN` | veebi aadress, nt `https://konevali-web.up.railway.app` (ilma kaldkriipsuta lõpus) |
| `KONEVALI_TOKEN` | juhuslik võti, vähemalt 32 märki, nt `openssl rand -hex 24` |
| `MAX_CONNECTIONS` | `2` (vaikimisi) |
| `NUM_THREADS` | `2` (vaikimisi) |
| `SPEAKER_MODEL` | valikuline: `/models/nemo_en_titanet_small.onnx` (40 MB). Ilma selleta nimesid ei ole |

- Genereeri avalik domeen. `PORT` seab Railway ise.

## 2. Veebileht

Muutujad (ehitamise ajal):

| Muutuja | Väärtus |
|---|---|
| `NITRO_PRESET` | `node-server` (muidu ehitab Lovable'i konfiguratsioon Cloudflare'i jaoks) |
| `VITE_LIVE_URL` | live-serveri aadress, **`wss://`** (nt `wss://konevali-live.up.railway.app`) |
| `VITE_CONTACT` | kontakt privaatsuslehele |
| `VITE_HOSTING` | tegelik piirkond ja hostija, nt "Heli töödeldakse Railway serveris (Railway Corp., USA ettevõte), piirkond: …" |

- Ehituse käsk: `npm run build`. Käivituskäsk: `node .output/server/index.mjs`.
- Ära pane salajast võtit ühtegi `VITE_`-muutujasse: need satuvad avalikku JavaScripti.

Järjestus: kõigepealt live (et saada domeen), siis web (`VITE_LIVE_URL`), lõpuks pane live'ile `WEB_ORIGIN`.

## 3. Link kasutajale

```
https://<veebi-domeen>/vali?live#key=<KONEVALI_TOKEN>
```

Võti on aadressi lõpus pärast `#`: seda ei saadeta ühelegi serverile päringuga ega jää hostija logidesse. Lehe avamisel küsitakse kõigilt ruumisolijatelt nõusolekut ("Enne alustamist"), enne kui mikrofon käivitub.

## 4. Kuiv proov (enne iga teist inimest)

1. Ava link üksi, alusta, räägi 2 minutit. Tekst peab ilmuma ja viivitus olema mõistlik.
2. **Mikrofon keelatud** brauseris: lehel peab olema teade ja "Proovi uuesti".
3. **Vale võti** aadressis: "Juurdepääsuvõti puudub või ei sobi."
4. **Live-server peatatud** käsitsi: "Ühendus serveriga katkes."
5. **Peata**: mikrofoni ikoon brauseris kaob.
5b. **Nimed** (kui `SPEAKER_MODEL` on seatud): "Alusta nimedega" → kiht B → kinnita → lisa kaks osalejat, kumbki annab häälenäite → laused saavad õiged nimed, kolmas hääl on "Tundmatu". "Eemalda profiil" ja "Nimed välja" muudavad järgmised laused nimetuks. Lehe uuesti laadimine alustab nimedest puhtalt.
6. Vaata Railway logisid: seal ei tohi olla ühtegi lauset ega heli, ainult "yhendus avatud/suletud".
7. Ava `/privaatsus`: kontakt ja piirkond on õiged.

## Lahtised sammud

- **Mudeli viimine Railwayle.** Kaks varianti, kumbagi pole proovitud: (a) kopeerida kaust köitele käsitsi, (b) laadida serveri käivitusel alla. Variant (b) vajab allika ja suuruse kinnitamist.
- **Dockerfaili ei ole ehitatud** (kohalikus masinas pole Dockerit). Sõltuvused (`sherpa-onnx==2.0.1`, `numpy==2.5.4`, `websockets==17.4`) on need, millega server on arendatud, aga Linuxi ja Python 3.12 rataste olemasolu on kontrollimata.
- **Jõudlus Railwayl on mõõtmata.** Mõõtmine on kohalikul masinal: viivitus lause lõpust ~1,5 s. Kui Railwayl on viivitus üle ~3 s, vaja suuremat plaani.
