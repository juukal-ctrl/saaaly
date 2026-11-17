# SääÄly – AI Weather (testiversio 0.3.0)

Sääsovellus, joka hakee ennusteen usealta säämallilta (ECMWF, MET Norway, DWD ICON, Météo-France, UK Met Office, NOAA GFS, Kanadan GEM ja kokeiluna Ilmatieteen laitos), yhdistää ne **koodilla** yhdeksi tunti- ja päiväennusteeksi ja antaa **tekoälyn** (Gemini) selittää sään valitulle ajalle ja paikalle. Mukana on chat, jolla voi kysyä säästä suomeksi, myös toisen paikkakunnan säästä.

**Chat vastaa sovelluksen omalla datalla.** Se toimii ilman Gemini-avainta: sovelluksen oma vastausmoottori laskee vastauksen siitä datasta, jonka sovellus on kerännyt eri säämalleilta (yhdistelmäennuste ja jokaisen mallin omat luvut). Gemini on valinnainen lisä, ja senkin voi rajata käyttämään vain sovelluksen dataa. Jokaisen vastauksen alla lukee, mistä se tuli.

**Uutta versiossa 0.3.0** (koko lista: `CHANGELOG.md`): sääkaavio (lämpötila, sade, tuuli ja aurinko yhdessä kuvassa, 24 h / 48 h / 7 pv), tutkapohjainen lähiennuste ("sade alkaa noin 15 min päästä"), viralliset Ilmatieteen laitoksen varoitukset (kun lähde vastaa), aiempaa paljon parempi suomen ymmärrys chatissa (arkikieli, kirjoitusvirheet, englanti, uusia aiheita), sovelluksen oma "Uusi versio saatavilla" -ilmoitus, akkua säästävä taivasanimaatio, kaatumissuojaus ja tietoturvapolitiikka (CSP).

Tekoäly ei laske lämpötiloja. Luvut tulevat mallien yhdistelmästä (poikkeavat mallit karsitaan pois), ja tekoäly selittää valmiin tuloksen. Siksi luvut ovat samat kuin etusivulla ja tarkistettavissa mallivertailusta.

## Mitä zipissä on

| Kansio tai tiedosto | Mikä se on |
|---|---|
| `julkaise/` | **Valmis julkaisupaketti: 11 tiedostoa, ei alikansioita. Vain nämä viedään GitHubiin.** |
| `CHANGELOG.md` | Mitä kussakin versiossa on muuttunut |
| `README.md` | Tämä ohje |
| `esikatselu.html` | Esikatselu esimerkkidatalla, toimii ilman nettiyhteyttä |
| `js/`, `css/`, `icons/`, `tests/`, `tools/` | Lähdekoodi, testit ja työkalut (kehittäjälle, ei tarvita julkaisussa) |

### Repossa (github.com/juukal-ctrl/saaaly)

Repon **juuressa** ovat julkaistut tiedostot (`index.html`, `saaaly.js` ja muut yksitoista; GitHub Pages tarjoilee ne osoitteesta juukal-ctrl.github.io/saaaly/). **Lähdekoodi, testit ja työkalut ovat kansiossa `src/`** (`js/`, `css/`, `icons/`, `tests/`, `tools/`). Juuren tiedostot ovat generoituja: älä muokkaa niitä käsin, vaan muuta `src/`-kansiota ja julkaise näin:

```
cd src
node --test tests/*.test.js     # yksikkötestit
node tools/build.mjs            # koostaa src/julkaise/
node tools/publish.mjs          # kopioi yksitoista tiedostoa repon juureen
cd .. && git add -A && git commit && git push
```

## 1. Katso ensin, miltä se näyttää

Tietokoneella: avaa `esikatselu.html` tuplaklikkaamalla. Se käyttää **tekaistua** esimerkkisäätä, mutta kaikki ominaisuudet ovat mukana. Chat vastaa esikatselussa sovelluksen omalla laskennalla (Gemini ei ole esikatselussa käytössä). Osoitteen perään voi lisätä `?demo=rain`, `?demo=snow`, `?demo=thunder`, `?demo=fog` tai `?demo=clear` eri säätilojen katsomiseen. Puhelimella voit ohittaa tämän kohdan ja siirtyä suoraan kohtaan 2.

## 2. Julkaise puhelimelle (GitHub Pages, noin 10 minuuttia, ilmainen)

Oikeaa säädataa ei voi testata tiedostosta, joten sovellus tarvitsee osoitteen (https). Helpoin tapa on GitHub Pages.

Julkaisuun tarvitaan vain kansion **`julkaise`** yksitoista tiedostoa. Kansiossa ei ole alikansioita, koska Androidin tiedostovalitsin ei osaa valita kansioita.

Tässä ohjeessa käytetään repositorya `github.com/juukal-ctrl/saaaly`. Jos teet uuden: paina **+ → New repository**, nimeksi `saaaly`, valitse **Public** ja paina **Create repository**.

### A. Pura zip

1. Avaa ladattu zip Tiedostot-sovelluksessa (yleensä *Lataukset*-kansiossa) ja valitse **Pura** (*Extract*).
2. Avaa purettu kansio `saaaly` ja sen sisältä `julkaise`. Siellä pitää olla yksitoista tiedostoa: `index.html`, `saaaly.js`, `crash.js`, `app.css`, `sw.js`, `version.json`, `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png` ja `icon-maskable-512.png`.

### B. Lataa tiedostot GitHubiin

1. Avaa Chromessa `github.com/juukal-ctrl/saaaly`. Tyhjällä repositoryllä näkyy laatikko *Quick setup*. Napauta sen tekstistä sinistä linkkiä **uploading an existing file**. Samalle sivulle pääsee myös suoraan osoitteella `github.com/juukal-ctrl/saaaly/upload/main`.
2. Napauta **choose your files**. Mene kansioon `julkaise`, paina yhtä tiedostoa pitkään ja napauta sitten muut, kunnes kaikki yksitoista on valittu (tai valitse kolmen pisteen valikosta *Valitse kaikki*). Vahvista valinta (*Avaa*).
3. Odota, että kaikki yksitoista tiedostoa näkyvät sivun listassa. Vieritä alas ja napauta vihreää **Commit changes**.
4. Tarkista, että repositoryn etusivulla on yksitoista tiedostoa eikä yhtään kansiota.

### C. Kytke GitHub Pages päälle

1. Avaa `github.com/juukal-ctrl/saaaly/settings/pages`.
2. Kohdassa *Build and deployment* valitse *Source: Deploy from a branch*. Kohdassa *Branch* valitse `main` ja kansioksi `/ (root)`. Paina **Save**.
3. Odota 1–2 minuuttia ja päivitä sivu. Yläreunaan tulee teksti *Your site is live at* ja osoite **`https://juukal-ctrl.github.io/saaaly/`**.

Jos sivulla lukee *Upgrade or make this repository public*, repositoryn näkyvyys on *Private*. Avaa `github.com/juukal-ctrl/saaaly/settings`, vieritä alimmaiseksi (*Danger Zone*) ja valitse **Change visibility → Make public**. Tiedostoissa ei ole mitään salaista. Gemini-avainta ei koskaan laiteta tiedostoihin, vaan se tallennetaan vain oman puhelimen selaimeen.

### D. Avaa puhelimella

Avaa osoite **Androidin Chromessa**, salli sijainti ja valitse kolmen pisteen valikosta **Lisää aloitusnäytölle** (tai *Asenna sovellus*). Sovellus avautuu sen jälkeen kuin tavallinen sovellus.

### Uusi versio myöhemmin

Kun saat päivityksen: avaa `github.com/juukal-ctrl/saaaly/upload/main`, valitse päivitetyt tiedostot ja paina **Commit changes**. Usein riittää yksi tiedosto (esimerkiksi `saaaly.js`). Zipin mukana tulee aina koko `julkaise`-kansio. Samannimiset tiedostot korvautuvat, joten tiedoston nimen pitää olla täsmälleen sama (ei esimerkiksi `saaaly (1).js`). Pages päivittyy 1–2 minuutissa. Sulje sovellus ja avaa se uudelleen. Version näet diagnostiikkaraportin ensimmäiseltä riviltä. Versiosta 0.3.0 alkaen sovellus huomaa uuden version itse ja näyttää ruudun alareunassa ilmoituksen **Uusi versio saatavilla** ja painikkeen **Päivitä**; sulkemista ja uudelleenavaamista ei tarvita.

### Jos uusi versio ei toimi: paluu edelliseen

Julkaisu merkitään git-tunnisteella (`v0.3.0`; edellinen oli `v0.2.0`). Paluu: avaa `github.com/juukal-ctrl/saaaly/releases`, valitse edellinen versio, lataa sen tiedostot ja vie ne uudelleen julkaisuun. Tai pyydä Claudea tekemään paluu.

### Tietokoneelta

Tietokoneella voit vetää `julkaise`-kansion tiedostot (ei itse kansiota) upload-sivulle. Vaihtoehto: app.netlify.com/drop antaa osoitteen, kun vedät sinne `julkaise`-kansion.

Jos jokin kohta ei näytä samalta kuin ohjeessa (GitHub muuttaa ulkoasuaan), ota kuvakaappaus ja liitä se Claudelle.

## 3. Chatin ja selityksen lähde (Gemini-avain on valinnainen)

Chatissa ja asetuksissa on kolmen tilan valitsin:

| Tila | Mitä tapahtuu | Tarvitsee avaimen |
|---|---|---|
| **Oma laskenta** | Ei tekoälyä. Sovelluksen oma vastausmoottori vastaa sovelluksen keräämästä säädatasta: sade, lumi, ukkonen, liukkaus, lämpö, tuuli, pukeutuminen, ulkoilu ja lenkki, aurinko, pilvisyys, mallien omat luvut ja niiden yhtäpitävyys, toisen paikkakunnan sää ja kahden paikan vertailu. Jatkokysymykset toimivat ("Entä Rovaniemellä?" tarkoittaa samaa ajankohtaa). Ymmärtää myös kuukaudet, juhlapyhät ja vuodenajat ("joulukuussa", "jouluna", "juhannuksena", "pääsiäisenä"), useamman vuorokaudenajan ("aamulla ja illalla"), sumun, myrskyn ja päivän pituuden. Ennusteen ulkopuolisesta ajasta kerrotaan rehellisesti, mutta auringon nousu ja lasku lasketaan tähtitieteellisesti mille tahansa päivälle. | ei |
| **Gemini + data** (oletus avaimen kanssa) | Gemini kirjoittaa vastauksen, mutta saa tietää vain sovelluksen säädatan, myös jokaisen mallin omat luvut. Muuta tietoa säästä sen ei pitäisi käyttää. | kyllä |
| **Gemini vapaa** | Luvut tulevat aina sovelluksen datasta, mutta Gemini saa lisäksi käyttää yleistietoa ilmiöiden selittämiseen ja neuvoihin. | kyllä |

Jokaisen vastauksen alla on lähdemerkintä: *Sovelluksen oma laskenta · 7/7 mallia*, *Gemini · data: sovelluksen säämallit* tai *Gemini ei vastannut (kiintiö täynnä) · sovelluksen oma laskenta*. Viimeinen tarkoittaa, että Gemini ei vastannut (kiintiö täynnä, ei verkkoa, virhe) ja sovellus vastasi itse. Käyttäjälle ei jää tyhjää virheilmoitusta.

Gemini-avaimen lisääminen:

1. Hae ilmainen avain osoitteesta aistudio.google.com/apikey.
2. Avaa sovelluksessa **Asetukset** (oikean yläkulman liukusäädinkuvake), liitä avain kenttään ja paina **Tallenna**. Tila vaihtuu samalla tilaan *Gemini + data*.
3. Paina **Testaa yhteys**. Jos mallin nimi ei kelpaa, paina **Hae mallit**: sovellus ehdottaa uusinta Flash-mallia.

Ilman avainta etusivun selityskortti näyttää koodilla laaditun suomenkielisen yhteenvedon ja chat vastaa omalla laskennalla. Ilmaisella avaimella on päivittäinen kiintiö, ja sovellus pyytää selityksen vain, kun valinta tai tunti vaihtuu, ei jokaisella päivityksellä. Avain tallentuu vain tämän puhelimen selaimeen.

## 4. Mitä kannattaa testata puhelimella

| Testaa | Odotettu tulos |
|---|---|
| Avaa sovellus ja salli sijainti | Otsikossa oikea paikkakunta ja maakunta (esim. *Turku, Varsinais-Suomi*), ei "Oma sijainti" |
| Vertaa lämpötilaa Ilmatieteen laitoksen havaintoon | Ero yleensä enintään 1–2 astetta. Avaa **Mallivertailu**: jokaisen mallin oma lukema ja ero yhdistelmään |
| Jätä sovellus auki 10 minuuttia tai paina päivityspainiketta | "Päivitetty" -kellonaika muuttuu |
| Napauta tuntia tai päivää | Selitys ja taivas vaihtuvat. Napauta "nyt" palataksesi |
| Vieritä **Sääkaavioon** ja kosketa tai vedä sormella sen päällä | Kaavio näyttää valitun hetken lämpötilan, sateen, tuulen ja sään. Painikkeilla vaihdat 24 h / 48 h / 7 pv. Näppäimistöllä nuolinäppäimet siirtävät kohtaa, Esc palauttaa |
| Katso vastauskaistan (*Mitä päälle ja mukaan*) ylintä riviä | Jos tutkaennuste vastaa, siinä lukee esimerkiksi *Tutkan mukaan sade alkaa noin 15 min päästä* tai *Tutkan mukaan ei sadetta seuraavaan 2 tuntiin*. Jos lähde ei vastaa, riviä ei näytetä eikä mitään virheilmoitusta tule |
| Odota sadepäivänä tai tuulisena päivänä ja katso sivun yläreuna | Jos Ilmatieteen laitoksella on varoitus alueellesi, se näkyy värillisenä rivinä merkinnällä *Ilmatieteen laitos*. Omat huomiot ovat katkoviivalla ja merkitty *SääÄlyn huomio* |
| Kysy chatissa: *Sataako vielä?*, *Voiko pyykin ripustaa ulos?*, *Will it rain tomorrow?*, *Mitä pitää päälle?* | Vastaus tulee omalla laskennalla. Arkikieli, kirjoitusvirheet ja englanti toimivat |
| Etsi toinen paikkakunta otsikon kautta | Ennuste ja nimi vaihtuvat, sijaintipainike palauttaa oman paikan |
| Avaa chat (*Kysy SääÄlyltä*) ilman avainta ja kysy: *Sataako huomenna?* | Vastaus tulee heti, alla lukee *Sovelluksen oma laskenta · N/N mallia*. Sateen alkamis- ja loppumisaika ja sademäärä täsmäävät etusivun tunti- ja päivälistaan |
| Kysy sen jälkeen: *Entä Rovaniemellä?* | Vastaus koskee Rovaniemeä ja samaa päivää (huomenna) |
| Kysy: *Mitä pukisin tänään?*, *Paljonko tuulee illalla?*, *Milloin on paras hetki lenkille?*, *Onko huomenna liukasta?* | Vastaus perustuu etusivun lukuihin (tuntuu kuin, tuuli, sade) eikä sisällä `**`-merkkejä tai "undefined"-tekstiä |
| Kysy: *Mitä mallit ennustavat huomiselle?* ja *Ovatko mallit samaa mieltä?* | Näet jokaisen mallin oman ennusteen ja sen, kuinka paljon ne eroavat. Luvut ovat samat kuin Mallivertailussa |
| Kysy: *Onko Oulussa kylmempää kuin Turussa?* | Vertailu kahdesta paikasta samalta ajalta |
| Lisää Gemini-avain ja vaihda chatin tila (*Oma laskenta*, *Gemini + data*, *Gemini vapaa*) | Alla oleva lähdemerkintä muuttuu. Oma laskenta ei kutsu Geminiä lainkaan |
| Sammuta verkko hetkeksi ja kysy Gemini-tilassa | Vastaus tulee silti, alla lukee *Gemini ei vastannut (ei verkkoyhteyttä)* ja että vastasi sovelluksen oma laskenta |

Jos jokin ei toimi: **Asetukset → Aja diagnostiikka → Kopioi raportti** ja liitä raportti Claudelle. Raportti kertoo mallikohtaisesti, vastaako palvelu, mitä lämpötilaa kukin malli antaa juuri nyt ja toimiiko Gemini. Raportin ensimmäisellä rivillä on version numero (nyt 0.3.0), ja siinä näkyy myös, toimiiko sovelluksen oma vastausmoottori. Raportin lopussa on osio **Valinnaiset lähteet**: siinä näet, vastaako tutkaennuste (MET Norway) ja Ilmatieteen laitoksen varoitussyöte juuri sinun puhelimessasi. Selain voi estää nämä yhteydet (CORS), eikä sitä voi tarkistaa muualta kuin oikealla laitteella. Jos ne on estetty, sovellus toimii ilman niitä.

## 5. Mitä tässä versiossa ei vielä ole

- **Valokuvamaiset aluetunnelmakuvat** (suurkaupunki ja maaseutu, vuodenajan mukaan). Taustana on nyt koodilla piirretty animoitu taivas: aurinko, kuu oikeassa vaiheessa, tähdet, pilvet, sade, lumi, ukkonen ja sumu. Kuvat ovat seuraava vaihe.
- **Ilmatieteen laitoksen havainnot** ennusteen korjaajana. Jos mallit poikkeavat toistuvasti havainnoista, lisätään havaintopohjainen korjaus.
- **Tutkaennuste ja viralliset varoitukset ovat varmistamattomia.** Niiden toimivuus riippuu siitä, sallivatko palvelut haut suoraan selaimesta. Sovellus kokeilee ja hiljenee, jos ei onnistu (ei virheilmoituksia, uusi yritys 15 min, 1 h, 6 h ja 24 h päästä). Tulos näkyy Tietoja-näkymässä ja diagnostiikassa.
- **Oikea Android-sovellus ja widget** (Play-kauppa). Suunnitelma perustuu widget-kyselyn vastauksiin. Nykyinen asennettava verkkosovellus toimii aloitusnäytöltä kuin sovellus, mutta se ei voi tarjota Androidin widgetiä.
- **Chatin oma vastausmoottori ei ole tekoäly.** Se tunnistaa suomenkielisen kysymyksen aiheen, ajankohdan ja paikan säännöillä. Epätavallisesti muotoiltu kysymys voi jäädä ymmärtämättä, jolloin se kertoo, mitä osaa vastata. Gemini-tilat ymmärtävät vapaamuotoisemmin.
- Ilmatieteen laitoksen oma malli ei ole Open-Meteon tarjoamien mallien joukossa (`fmi_seamless`-tunnusta ei ole), joten sovellus ei käytä sitä. Suomen tarkimmat mallit ovat MET Nordic ja ECMWF; virallinen ennuste ja varoitukset löytyvät ilmatieteenlaitos.fi:stä.

Sääennusteet: Open-Meteo.com (CC BY 4.0, ei-kaupalliseen käyttöön). Paikkahaku: Open-Meteo / GeoNames. Paikannimet: BigDataCloud ja © OpenStreetMap-tekijät.

## Tietolähteet ja yksityisyys

Sovellus ei käytä omaa palvelinta, mainoksia, analytiikkaa eikä seurantaa. Selain saa ottaa yhteyttä vain alla oleviin osoitteisiin (tietoturvapolitiikka `Content-Security-Policy` sivun alussa), ja `tests/deploy.test.js` varmistaa, että lista vastaa koodia.

| Osoite | Mihin | Mitä lähtee |
|---|---|---|
| `api.open-meteo.com` | Sääennusteet (kahdeksan mallia) | Sijainti pyöristettynä kahteen desimaaliin (noin 1 km) |
| `geocoding-api.open-meteo.com` | Paikkahaku | Hakusana |
| `api.bigdatacloud.net`, `nominatim.openstreetmap.org` | Paikan nimi sijainnista (jälkimmäinen varalla) | Koordinaatit |
| `api.met.no` | Tutkaennuste (valinnainen) | Sijainti pyöristettynä kahteen desimaaliin |
| `alerts.fmi.fi` | Viralliset varoitukset (valinnainen) | Ei mitään: koko maan syöte ladataan ja oma alue valitaan laitteella |
| `generativelanguage.googleapis.com` | Gemini (valinnainen, vain jos lisäät avaimen) | Kysymys ja sovelluksen säädata |

Paikka, asetukset ja välimuisti tallentuvat vain tämän laitteen selaimeen. Gemini-avainta ei koskaan laiteta tiedostoihin.

## Kehittäjälle

```
node --test tests/*.test.js            # yksikkötestit (178 kpl, noin 3 s)
node tools/build.mjs                   # kokoaa js/-moduulit tiedostoksi saaaly.js ja tekee esikatselun sekä julkaise/-kansion
node tools/publish.mjs                 # kopioi julkaise/-kansion tiedostot repon juureen (vain repossa, src/-kansiosta ajettuna)
python3 tools/e2e.py                   # selaintestit (40 kpl) julkaise/-kansiolle samasta alipolusta kuin GitHub Pages (vaatii Pythonin Playwrightin ja Chromiumin)
python3 tools/shot.py kuva.png "?demo=rain&at=2026-10-14T14:04:00%2B03:00"   # kuvakaappaus esimerkkitilasta (dev-palvelin: python3 -m http.server 8765 --bind 127.0.0.1)
E2E_TARGET=root python3 tools/e2e.py   # sama lähdekansiolle sellaisenaan
```

Chatin oma vastausmoottori on moduuleissa `js/nlu.js` (kysymyksen jäsennys), `js/answer.js` (vastaukset datasta) ja `js/gazetteer.js` (paikannimet ilman verkkoa). Valinnaiset lähteet: `js/sources.js` (varmistus ja odotusajat), `js/nowcast.js` (tutkaennuste) ja `js/warnings.js` (Ilmatieteen laitoksen CAP-varoitukset, oma XML-lukija). Sääkaavio on `js/meteogram.js`, ja neuvot (takki, sateenvarjo, liukkaus) `js/advice.js`. Sen testit ovat tiedostossa `tests/answer.test.js`: data on rakennettu käsin, joten oikeat vastaukset tiedetään tarkasti.

`js/` sisältää lähdekoodin, `saaaly.js` on siitä koottu tiedosto ja `julkaise/` on valmis julkaisupaketti (sama sisältö, tiedostopolut litistetty). Muutoksen jälkeen aja `node tools/build.mjs` ja vie `julkaise/`-kansion tiedostot julkaisuun.
