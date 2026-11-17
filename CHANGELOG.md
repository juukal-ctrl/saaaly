# Muutosloki

## 0.3.0 (2026-11)

Uutta

- **Sääkaavio**: lämpötila (vaihteluväli), sade (mediaani ja vaihteluväli), tuuli ja puuskat, aurinko ja yö yhdessä kuvassa. Aikavälit 24 h, 48 h ja 7 pv. Kosketus, vetäminen ja nuolinäppäimet tarkastavat kohdan; saatavilla myös taulukkona ja ruudunlukijalle.
- **Tutkaennuste** (MET Norway Nowcast, Pohjoismaat): "Tutkan mukaan sade alkaa noin 15 min päästä", "Sataa nyt (heikkoa). Tutkan mukaan sade päättyy noin 20 min päästä". Näkyy vastauskaistalla ja chatissa ("Sataako vielä?"). Kohina (yksittäinen heikko tutka-askel) suodatetaan, yli 30 min vanhaa ennustetta ei käytetä.
- **Viralliset säävaroitukset** Ilmatieteen laitoksen CAP-syötteestä: väri (keltainen, oranssi, punainen), voimassaoloaika ja ohje; valitaan laitteella pisteen ja monikulmion leikkauksella, joten sijaintia ei lähetetä. Omat huomiot, jotka virallinen varoitus jo kattaa, piilotetaan; rivejä on enintään kolme.
- **Chatin suomen ymmärrys** (asiantuntijan 08 paketti): ääkköseton kirjoitus, arkikieli ("keli", "kumpparit"), englanninkieliset kysymykset, aikailmaisut ("ens viikolla", "vkl", kellonajat sanoin), paikkojen lempinimet ja kirjoitusvirheet (Hesa, Turus, Åbo, Rovanimellä), uudet aiheet (sataako vielä, pyykki, ajokeli, talvirenkaat, kuu, vertailu päivien ja paikkojen välillä) sekä rehelliset kieltäytymiset. 420 lauseen mittauksessa 68,8 % → 98,3 % (mittaus tehty samalla aineistolla kuin korjaukset; ulkopuolinen taso arvio 85–90 %).
- **Uusi versio saatavilla** -ilmoitus: sovellus vertaa omaa versiotunnustaan tiedostoon `version.json` ja tarjoaa päivityspainikkeen.
- **Akkua säästävä taivas**: animaatio hidastuu ja pysähtyy, kun ruutuun ei kosketa tai akku on vähissä; Asetukset → Ulkoasu → Animaatio -kytkin.
- **Kaatumissuojaus**: rikkinäinen tallennettu tieto ei kaada käynnistystä, ja virhenäytöstä voi tyhjentää tiedot (Gemini-avain säilyy).
- **Tietoturvapolitiikka** (Content-Security-Policy): selain saa ottaa yhteyttä vain sovelluksen käyttämiin palveluihin; testi varmistaa, että lista vastaa koodia.
- Tietoja-näkymässä ja diagnostiikassa **Lisälähteet**: näkyy, vastaako kukin valinnainen lähde kyseisessä laitteessa.

Parannuksia

- Päivitys ei vaivu: haku on keskeytettävissä ja sillä on 10 s aikaraja; rinnakkaiset päivitykset yhdistyvät yhdeksi.
- Service worker uusittu: atomaarinen asennus, 3 s verkkoaikaraja ja välimuistiin palautuminen; vanhat välimuistit siivotaan.
- Sijainti pyöristetään kahteen desimaaliin kaikissa säähauissa.
- Näppäimistökohdistus säilyy uudelleenpiirrossa (myös sääkaavion napautuksen jälkeen).
- Pitkä sadejakso ("25 h") ei enää näy harhaanjohtavana kellonaikavälinä.
- Gemini-avaimen kenttä tarkistaa merkit (välilyönti tai erikoismerkki ei tallennu, ja virheestä kerrotaan selvästi), kertoo jos selain ei voi tallentaa avainta eikä ole salasanakenttä (selain ei tarjoa avaimen tallennusta salasanana). Tekoälyvastausten välimuisti on rajattu 50 vastaukseen.

Tiedossa (ei vielä tehty)

- Kesäaikaan siirtymä: aikaleimat on tarkoitus hakea Unix-aikana ennen 28.3.2027 (nyt Open-Meteon paikallisaika, jonka siirtymäkäyttäytymistä ei ole varmistettu).
- Tutkaennusteen ja varoitussyötteen CORS-tuki on varmistamaton; ne toimivat vain jos palvelut sallivat haun suoraan selaimesta (sovellus hiljenee muuten).
- Automaattinen julkaisuputki (GitHub Actions) vaatii omistajan toimen: Pagesin lähteeksi "GitHub Actions". Siihen asti julkaisu tehdään komennolla `node tools/publish.mjs` (ks. README).

## 0.2.0

Ensimmäinen julkaistu versio: usean mallin yhdistelmäennuste, selityskortti, chat omalla vastausmoottorilla (Gemini valinnainen), animoitu taivas, mallivertailu ja diagnostiikka.
