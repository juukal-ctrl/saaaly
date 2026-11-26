# SääÄly – AI Weather (versio 0.7.0)

Sääsovellus, joka hakee ennusteen usealta säämallilta (ECMWF, MET Norway, DWD ICON, Météo-France, UK Met Office, NOAA GFS, Kanadan GEM ja kokeiluna Ilmatieteen laitos), yhdistää ne **koodilla** yhdeksi tunti- ja päiväennusteeksi ja kertoo suoraan, mitä se tarkoittaa: mitä pukea, tarvitaanko sateenvarjoa ja milloin sade alkaa tai loppuu. Mukana on chat, jolta voi kysyä säästä suomeksi, myös toisen paikkakunnan säästä.

**Osoite:** https://juukal-ctrl.github.io/saaaly/ (Androidin Chromessa: kolmen pisteen valikko → **Lisää aloitusnäytölle**).

**Chat vastaa sovelluksen omalla datalla.** Se toimii ilman Gemini-avainta: sovelluksen oma vastausmoottori laskee vastauksen siitä datasta, jonka sovellus on kerännyt säämalleilta (yhdistelmäennuste ja jokaisen mallin omat luvut). Gemini on valinnainen lisä. Jokaisen vastauksen alla lukee, mistä se tuli.

Tekoäly ei laske lämpötiloja. Luvut tulevat mallien yhdistelmästä (poikkeavat mallit karsitaan pois), joten ne ovat samat kaikilla sivuilla ja tarkistettavissa Varmuus-sivun mallivertailusta.

Mitä kussakin versiossa muuttui: `CHANGELOG.md`.

## Näin sovellus toimii

Sovelluksessa on neljä sivua, joiden välillä liikutaan pyyhkäisemällä tai alapalkin pisteistä. Androidin takaisin-ele palaa kotisivulle.

| Sivu | Mitä siinä on |
|---|---|
| **Koti** | Lämpötila, tuntuu kuin, sää, tuuli ja päivän alin ja ylin. Iso otsikko kertoo olennaisen: takki ja mihin asti on kuivaa, tai sateenvarjo ja milloin sade alkaa tai loppuu. Kromiradalla seuraavat 10 tuntia; tunnin napautus näyttää sen tiedot ylhäällä. Varoitukset ovat otsikon yläpuolella. |
| **Tunnit** | Tuntilista (13 tuntia, "Näytä 48 tuntia"). Rivin napautus avaa tuulen, puuskat, sateen, pilvisyyden ja mallien eron (nyt-rivillä myös lähimmän sääaseman mittauksen). Kaavio-näkymässä sääkaavio 24 h / 48 h / 7 vrk. Kun sade on lähellä, tutkan sadekäyrä näyttää seuraavat 2 tuntia. |
| **Viikko** | Seitsemän päivää, viikon suunta ja sadepäivät otsikossa, viikonlopun yhteenveto. Päivän napautus avaa sen tunnit. |
| **Varmuus** | Kuinka luotettava ennuste on tänään ja huomenna. Jokainen helmi on yksi säämalli: vasemmalla kylmempi, oikealla lämpimämpi kuin SääÄlyn ennuste. Lisäksi mallivertailu ja lähimmän sääaseman havainto. |

Yläpalkin **Tänään / Huomenna** vaihtaa kotisivun ja Tunnit-sivun huomiseen. **Kysy SääÄlyltä** avaa chatin. Valikosta (☰) löytyvät päivitys, sijainti, pukeutumisen kylmänsietokyky, päivitysväli, taustan animaatio, tiedot ja lisäasetukset.

## Chatin vastausten lähde (Gemini-avain on valinnainen)

Valinta on kohdassa **Valikko → Lisäasetukset → Vastausten lähde** (chatista pääsee sinne linkistä "vaihda").

| Tila | Mitä tapahtuu | Tarvitsee avaimen |
|---|---|---|
| **Oma laskenta** | Ei tekoälyä. Sovelluksen oma vastausmoottori vastaa sovelluksen keräämästä säädatasta: sade, lumi, ukkonen, liukkaus, lämpö, tuuli, pukeutuminen, ulkoilu ja lenkki, aurinko, pilvisyys, mallien omat luvut ja niiden yhtäpitävyys, toisen paikkakunnan sää ja kahden paikan vertailu. Jatkokysymykset toimivat ("Entä Rovaniemellä?" tarkoittaa samaa ajankohtaa). Ymmärtää myös kuukaudet, juhlapyhät ja vuodenajat. | ei |
| **Gemini + data** (oletus avaimen kanssa) | Gemini kirjoittaa vastauksen, mutta saa tietää vain sovelluksen säädatan, myös jokaisen mallin omat luvut. | kyllä |
| **Gemini vapaa** | Luvut tulevat aina sovelluksen datasta, mutta Gemini saa lisäksi käyttää yleistietoa ilmiöiden selittämiseen ja neuvoihin. | kyllä |

Jos Gemini ei vastaa (kiintiö täynnä, ei verkkoa, virhe), sovellus vastaa itse ja kertoo sen vastauksen alla.

Gemini-avaimen lisääminen: hae ilmainen avain osoitteesta aistudio.google.com/apikey, avaa **Valikko → Lisäasetukset**, liitä avain ja paina **Tallenna** ja sitten **Testaa yhteys**. Jos mallin nimi ei kelpaa, **Hae mallit** ehdottaa uusinta Flash-mallia. Avain tallentuu vain tämän puhelimen selaimeen, ei koskaan tiedostoihin.

## Mitä kannattaa testata puhelimella

| Testaa | Odotettu tulos |
|---|---|
| Avaa sovellus ja salli sijainti | Yläpalkissa oikea paikkakunta ja sen alla maakunta |
| Katso kotisivun otsikkoa kuivana ja sateisena päivänä | Kuivana: takki ja "Kuivaa klo X asti" tai "koko päivän". Sateella: sateenvarjo ja sateen alkamis- tai loppumisaika. Sama aika näkyy Tunnit-sivulla |
| Napauta radan tuntia | Tunnin tiedot näkyvät ylhäällä merkinnällä "Tänään klo 17"; "×" palaa nykyhetkeen |
| Napauta **Huomenna** | Otsikko, lämpötila ja rata kertovat huomisesta |
| Pyyhkäise Tunnit-sivulle ja napauta riviä | Rivi avautuu paikallaan. "Näytä 48 tuntia" jatkaa listaa |
| Valitse Tunnit-sivulla **Kaavio** ja vedä sormella kaavion päällä | Kaavio näyttää valitun hetken lämpötilan, sateen ja tuulen |
| Avaa Varmuus-sivu | Kahdeksan helmeä tänään ja huomenna; teksti kertoo, ovatko mallit samaa mieltä |
| Odota varoituspäivää | Ilmatieteen laitoksen varoitus näkyy värirenkaalla, oma huomio katkoviivalla. Napautus avaa tekstin |
| Kysy chatissa: *Milloin sataa seuraavan kerran?*, *Mitä pukisin huomenna?*, *Entä Rovaniemellä?* | Vastaus tulee heti omalla laskennalla, ja ajat täsmäävät sivujen kanssa |
| Paina Androidin takaisin-elettä toisella sivulla | Sovellus palaa kotisivulle eikä sulkeudu |

Jos jokin ei toimi: **Valikko → Lisäasetukset → Aja diagnostiikka → Kopioi raportti** ja liitä raportti Claudelle. Raportin ensimmäisellä rivillä on versio, ja lopussa osio **Valinnaiset lähteet** kertoo, vastaavatko tutkaennuste, varoituspeili ja havaintoasema juuri sinun puhelimessasi ja miksi eivät.

## Mitä tässä versiossa ei vielä ole

- **Tutkakartta.** Tunnit-sivulla on tutkan sadekäyrä seuraaville 2 tunnille; kartta tulee myöhemmin.
- **Oikea Android-sovellus ja widget** (Play-kauppa). Nykyinen verkkosovellus toimii aloitusnäytöltä kuin sovellus, mutta se ei voi tarjota widgetiä.
- **Chatin oma vastausmoottori ei ole tekoäly.** Se tunnistaa kysymyksen aiheen, ajankohdan ja paikan säännöillä. Epätavallisesti muotoiltu kysymys voi jäädä ymmärtämättä, jolloin se kertoo, mitä osaa vastata. Gemini-tilat ymmärtävät vapaamuotoisemmin.
- Ilmatieteen laitoksen oma malli ei ole Open-Meteon mallien joukossa, joten sovellus ei käytä sitä. Virallinen ennuste ja varoitukset löytyvät ilmatieteenlaitos.fi:stä.

## Tietolähteet ja yksityisyys

Sovellus ei käytä omaa palvelinta, mainoksia, analytiikkaa eikä seurantaa. Selain saa ottaa yhteyttä vain alla oleviin osoitteisiin (tietoturvapolitiikka `Content-Security-Policy`), ja `tests/deploy.test.js` varmistaa, että lista vastaa koodia.

| Osoite | Mihin | Mitä lähtee |
|---|---|---|
| `api.open-meteo.com` | Sääennusteet (kahdeksan mallia) | Sijainti pyöristettynä kahteen desimaaliin (noin 1 km) |
| `geocoding-api.open-meteo.com` | Paikkahaku | Hakusana |
| `api.bigdatacloud.net`, `nominatim.openstreetmap.org` | Paikan nimi sijainnista (jälkimmäinen varalla) | Koordinaatit |
| `api.met.no` | Tutkaennuste (valinnainen) | Sijainti pyöristettynä kahteen desimaaliin |
| `opendata.fmi.fi` | Lähimmän sääaseman havainto (valinnainen) | Sijainti pyöristettynä kahteen desimaaliin |
| `raw.githubusercontent.com` | Viralliset varoitukset (valinnainen): repon haarassa `warnings-data` oleva peili Ilmatieteen laitoksen syötteestä | Ei sijaintia: koko maan varoitukset ladataan ja oma alue valitaan laitteella |
| `generativelanguage.googleapis.com` | Gemini (valinnainen, vain jos lisäät avaimen) | Kysymys ja sovelluksen säädata |

Paikka, asetukset ja välimuisti tallentuvat vain tämän laitteen selaimeen. Fontti (Inter Display, SIL Open Font License, `inter-OFL.txt`) tulee sovelluksen mukana, joten sitä ei haeta muualta.

Sääennusteet: Open-Meteo.com (CC BY 4.0). Havainnot ja varoitukset: Ilmatieteen laitos (CC BY 4.0). Tutkaennuste: MET Norway. Paikkahaku: Open-Meteo / GeoNames. Paikannimet: BigDataCloud ja © OpenStreetMap-tekijät.

## Varoituspeili (GitHub Actions)

Ilmatieteen laitoksen varoitussyöte (`alerts.fmi.fi`) ei salli selaimen suoraa hakua (CORS), joten repossa on ajo `.github/workflows/mirror-warnings.yml`: se hakee syötteen, `src/tools/mirror-warnings.mjs` tiivistää sen ja tulos tallentuu haaraan `warnings-data` tiedostoksi `warnings.json`. Sovellus lukee sen ja valitsee omaa paikkaa koskevat varoitukset laitteella. Haara tehdään joka kerta yhdeksi commitiksi, joten historia ei kasva.

- **Ajastus:** GitHubin oma ajastin on epäluotettava (ajot viivästyvät tunteja), joten ajo kannattaa käynnistää ulkoisella ajastimella (esimerkiksi cron-job.org) neljännestunnin välein GitHubin rajapinnan kautta. Ohje on alla. GitHubin oma ajastus jää varalle.
- **Jos varoitukset eivät näy:** diagnostiikan kohta *Valinnaiset lähteet* kertoo syyn. Ajon voi käynnistää käsin: repon **Actions** → *Peilaa säävaroitukset* → **Run workflow**. Yli kuusi tuntia vanhaa peiliä sovellus ei käytä, ja yli 90 minuuttia vanhasta tiedosta kotisivu näyttää merkin "tarkista Ilmatieteen laitokselta".
- Ajo ei epäonnistu, vaikka Ilmatieteen laitoksen palvelu olisi alhaalla; edellinen peili jää voimaan.

### Ulkoinen ajastin (cron-job.org)

1. GitHubissa: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Repository access: *Only select repositories* → `saaaly`. Permissions: **Actions: Read and write**. Kopioi tunnus talteen (se näytetään vain kerran).
2. cron-job.org:ssa luo uusi ajo:
   - URL: `https://api.github.com/repos/juukal-ctrl/saaaly/actions/workflows/mirror-warnings.yml/dispatches`
   - Aikataulu: 15 minuutin välein
   - Lisäasetuksista: metodi **POST**, otsakkeet `Authorization: Bearer <tunnus>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, runko `{"ref":"main"}`
3. Onnistunut kutsu palauttaa tilan 204, ja repon Actions-välilehdelle ilmestyy ajo.

Tunnus antaa oikeuden vain tämän repon ajoihin. Älä laita sitä repoon tai sovellukseen.

## Kehittäjälle

Repon juuressa ovat julkaistut tiedostot (GitHub Pages tarjoilee ne). Lähdekoodi, testit ja työkalut ovat kansiossa `src/`. Juuren tiedostot ovat generoituja: muuta `src/`-kansiota ja julkaise näin:

```
cd src
node --test tests/*.test.js            # yksikkötestit (219 kpl)
node tools/build.mjs                   # kokoaa js/-moduulit tiedostoksi saaaly.js, esikatselun ja julkaise/-kansion
node tools/publish.mjs                 # kopioi julkaise/-kansion tiedostot repon juureen
python3 tools/e2e.py                   # selaintestit (43 kpl) julkaise/-kansiolle samasta alipolusta kuin GitHub Pages
python3 tools/shot.py kuva.png "?demo=rain&at=2026-10-14T14:04:00%2B03:00"   # kuvakaappaus esimerkkitilasta
cd .. && git add -A && git commit && git push
```

Esikatselu esimerkkidatalla: `node tools/build.mjs` tekee tiedoston `src/esikatselu.html`, joka toimii ilman verkkoa. Osoitteen perään voi lisätä `?demo=rain`, `snow`, `thunder`, `fog` tai `clear` ja ajan, esimerkiksi `&at=2026-10-14T23:30:00%2B03:00`.

Rakenne: `js/headline.js` (etusivun, Tunnit-, Viikko- ja Varmuus-sivujen otsikot), `js/views.js` (sivujen HTML), `js/app.js` (tila, sivut ja päivitys), `js/blend.js` (mallien yhdistäminen ja sadejaksot), `js/advice.js` (takki, sateenvarjo, liukkaus), `js/meteogram.js` (sääkaavio), `js/sky.js` (animoitu taivas). Chatin oma vastausmoottori: `js/nlu.js`, `js/answer.js` ja `js/gazetteer.js`. Valinnaiset lähteet: `js/sources.js` (varmistus ja odotusajat), `js/nowcast.js` (tutkaennuste), `js/warnings.js` (varoitukset) ja `js/observations.js` (havainnot).

Jokainen versio on oma commitinsa. Jos uusi versio ei toimi, edelliseen palaa `git revert`illä (tai pyydä Claudea tekemään paluu).
