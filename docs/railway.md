# Kõneväli Railwayl: pilootversioon

Kaks teenust ühes Railway projektis: **live** (Python, kõnetuvastus, nimed) ja **web** (leht). Ainult pilootkatseks: mitte avalik teenus. Mudelid laaditakse **Dockeri ehituse ajal** (kinnitatud commit'i, suuruse ja SHA-256-ga), volume'i ei ole vaja.

Nimed on **valikulised ja sessioonipõhised**: häälejäljed elavad ainult ühe ühenduse serverimälus ja kustuvad, kui nimed lülitatakse välja, profiil eemaldatakse või ühendus sulgub. Server keeldub avalikul aadressil käivitumast ilma `KONEVALI_TOKEN`-ita ning `--verbose`'iga.

## Enne alustamist (sinu poolel)

- **Railway konto ja Hobby plaan.** Trial on liiga väike (1 GB RAM, live-teenus kasutab ~1,1 GB).
- **EU piirkond** mõlemale teenusele (EU West, Amsterdam). Kirjuta tegelik piirkond ja ettevõte `VITE_HOSTING`-isse. Railway on USA ettevõte: ära kirjuta "EL-is", kui seda pole kontrollitud.
- Loe läbi ja aktsepteeri Railway andmetöötluse tingimused (DPA).
- **Kõneleja mudeli litsents** (`nemo_en_titanet_small.onnx`) on kontrollimata. Kõnetuvastusmudel on Apache-2.0. Enne kui piloodis on teisi inimesi, kontrolli NeMo mudeli tingimused (või vaheta mudel).
- Pane kirja kontakt (`VITE_CONTACT`): kes vastutab ja kelle poole pöörduda.

## Mis ehituse ajal alla laaditakse (kokku ~638 MB)

`tools/fetch-models.py` laeb ja kontrollib. Vale suuruse või räsi korral ehitus **kukub**.

| Fail | Allikas | Suurus |
|---|---|---|
| `encoder.onnx`, `decoder.onnx`, `joiner.onnx`, `tokens.txt` | Hugging Face, `TalTechNLP/streaming-zipformer-large.et-en.w2n`, commit `82d23225…` | 598 MB |
| `nemo_en_titanet_small.onnx` | GitHub, k2-fsa/sherpa-onnx, release `speaker-recongition-models` | 40 MB |

## 1. Live-teenus

- Dockerfile: `tools/live.Dockerfile` (teenuse muutuja `RAILWAY_DOCKERFILE_PATH=tools/live.Dockerfile`). Ehituse kontekst on repo juur.
- Muutujad:

| Muutuja | Väärtus |
|---|---|
| `WEB_ORIGIN` | veebi aadress, nt `https://konevali-web.up.railway.app` (**ilma kaldkriipsuta**, täpselt sama mis brauseri aadress) |
| `KONEVALI_TOKEN` | juhuslik võti, vähemalt 32 märki, nt `openssl rand -hex 24` |
| `MAX_CONNECTIONS` | `2` (vaikimisi) |
| `NUM_THREADS` | `2` (vaikimisi) |
| `SPEAKER_MODEL` | vaikimisi pildis olev nemo; tühja väärtuse korral **nimed puuduvad** |

- Ressursid: **2 vCPU ja 2 GB** (mõõdetud kohalikul masinal ~1,1 GB RAM ja 0,4 vCPU voo kohta; Railwayl võib CPU-d vaja olla rohkem).
- Genereeri avalik domeen. `PORT` seab Railway ise.

## 2. Veebileht

- Dockerfile: `tools/web.Dockerfile` (`RAILWAY_DOCKERFILE_PATH=tools/web.Dockerfile`).
- Muutujad (**ehituse ajal**, Dockerfile deklareerib neile `ARG`-id):

| Muutuja | Väärtus |
|---|---|
| `VITE_LIVE_URL` | live-serveri aadress, **`wss://`** (nt `wss://konevali-live.up.railway.app`) |
| `VITE_CONTACT` | kontakt privaatsuslehele |
| `VITE_HOSTING` | tegelik piirkond ja hostija, nt "Heli töödeldakse Railway serveris (Railway Corp., USA ettevõte), piirkond: EU West (Amsterdam)." |

- **Ära pane salajast võtit ühtegi `VITE_`-muutujasse:** need satuvad avalikku JavaScripti.
- Muutuja muutmine nõuab uut ehitust (ei piisa taaskäivitusest).

## 3. Järjestus

1. Loo **live**, pane muutujad (WEB_ORIGIN esialgu ajutine), genereeri domeen.
2. Loo **web** `VITE_LIVE_URL=wss://<live-domeen>`-iga, genereeri domeen.
3. Pane live'ile `WEB_ORIGIN=https://<web-domeen>` ja taaskäivita live.

## 4. Link kasutajale

```
https://<veebi-domeen>/vali?live#key=<KONEVALI_TOKEN>
```

Võti on aadressi lõpus pärast `#`: seda ei saadeta ühelegi serverile päringuga ega jää hostija logidesse. Enne mikrofoni käivitumist küsitakse kõigilt ruumisolijatelt nõusolekut. Kui leht on ehitatud `VITE_LIVE_URL`-iga, on see **vaikimisi päris sessioon** (`?live` pole vaja); väljamõeldud vestlust ei näidata väljal kunagi (avalehel on eraldi illustratsioon). Ilma `#key=…`-ta ütleb leht "Juurdepääsuvõti puudub või ei sobi".

## 5. Kuiv proov (enne iga teist inimest)

1. **Viivituse mõõtmine Railwayle**, oma masinast, päris kõnega:
   ```
   KONEVALI_TOKEN=<võti> python tools/live-test-client.py kõne.wav --url wss://<live-domeen> --speed 1
   ```
   "hilinemine" peab olema ligikaudu kohaliku (~1,5 s). Kui üle ~3 s, suurenda CPU-d enne, kui keegi teine seda kasutab.
2. Ava link üksi, nõusoleku kaart, nimeta kasutus: tekst peab ilmuma.
3. Nimedega kahe häälega: häälenäited, õiged nimed, "Eemalda profiil", "Nimed välja".
4. **Mikrofon keelatud**: teade ja "Proovi uuesti". **Vale võti**: "Juurdepääsuvõti puudub või ei sobi." **Live peatatud**: "Ühendus serveriga katkes."
5. **Railway logid:** ainult "yhendus avatud/suletud", ühtegi lauset, nime ega heli.
6. `/privaatsus`: kontakt ja piirkond on õiged.

## Kulu ja peatamine

Mälu on pidevalt ~1 GB, seega teenus maksab ka siis, kui keegi seda ei kasuta (Railway: RAM $10/GB kuus, CPU $20/vCPU kuus kasutuse järgi). Testide vahel saab teenused peatada.

## Mida ei ole kontrollitud

- **Dockerfaile ei ole ehitatud** (kohalikus masinas pole Dockerit). Kontrollitud on: kõik ülalolevad failid ja räsid (kohalike failide vastu ja HF/GitHub päisedega), Linuxi/Python 3.12 rattad PyPI-s (`sherpa-onnx`, `sherpa-onnx-core`, `numpy`, `websockets`), veebi ehituse väljund töötab eraldi kaustas ilma `node_modules`'ita.
- Live-pildi ehitus kontrollib `import sherpa_onnx`'i: kui `python:3.12-slim`-is puudub mõni jagatud teek, kukub ehitus kohe, mitte käivitusel.
- Veebi ehitus kasutab `bun install --frozen-lockfile` (`bunfig.toml` 24 h vanuse piiranguga). Kohalik ehitus oli npm'iga.
- **Jõudlus Railwayl** on mõõtmata. "Tekst hilineb" teadet ei ole veel (manifest nõuab).
- Kõneleja mudeli litsents.
