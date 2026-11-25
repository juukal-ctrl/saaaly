# Muutosloki

## 0.6.0 – Hyväksytty konsepti käyttöön

- **Elävät pastellitaustat** aamulle, päivälle, illalle ja yölle (yö on violetti, ei lähes musta). Yläpalkissa on paikkapilleri, Tänään/Huomenna-valitsin ja valikkopainike; alalaidassa lasinen "Kysy SääÄlyltä" -pilleri. Päivitys ja "Käytä sijaintiani" ovat asetuksissa.
- **Tunnit**: pystylista 24 tunnille, jossa jokaisella tunnilla on kuvake, lämpötila ja sateen todennäköisyyspalkki. Otsikko kertoo, milloin sade alkaa tai loppuu.
- **Viikko**: kromikapselit lämpötilaväleille ja viikon yhteenveto otsikossa. Päivän napautus avaa edelleen sen tunnit.
- **Varmuus**: helmirypäs näyttää, kuinka samaa mieltä säämallit ovat tänään ja huomenna.
- Sateenvarjolause mahtuu kahdelle riville, ja radan tuntiobjektit on sijoiteltu uudelleen niin, etteivät ne peitä tekstiä.

## 0.5.0 – Uusi etusivu

- **Etusivu rakennettu uudelleen**: iso lihavoitu lämpötila, pehmeä 3D-kuvake, iso sateenvarjolause ja pieni takkirivi ilman laatikoita. Tänään/Huomenna-valinta on lauseen alla.
- **Kromirata**: seuraavat 12 tuntia kulkevat radalla, ja jokaisella tunnilla on oma sääobjekti, lämpötila ja kellonaika. Tunnin voi napauttaa. Yöllä rata ja tausta ovat tummat.
- Mitoitus skaalautuu ruudun leveyden mukaan (360–480 px). Tutkalause, lisähuomiot ja päivän ääriarvot ovat hiljaisena osiona radan alla.

## 0.4.0 – Pehmeä pastelliteema ja päivän tuntiennuste

- **Uusi ulkoasu**: päivällä ja aamu- ja ilta-auringossa taivas on pastellinen (persikka, vaaleanpunainen, laventeli, taivaansininen) ja teksti tumma indigo; yöllä tumma teema säilyy. Teema vaihtuu auringon korkeuden mukaan ja myös selaimen teemaväri seuraa sitä. Sade ei harmauta vaaleaa taivasta kokonaan.
- **3D-sääkuvakkeet**: aurinko, kuu, pilvet, sade, lumi ja ukkonen ovat pehmeitä helmiäisobjekteja (esirenderöidyt kuvat, toimivat ilman verkkoa). Käytössä sankarissa, tuntinauhassa ja päiväennusteessa; sumulle on oma raitakuvake. Sankarin kuvake kelluu hitaasti (ei, kun liikettä on vähennetty).
- **Kromiraita** kulkee tuntinauhan ruutujen alla ja vierii niiden mukana.
- **Päivän tunnit**: kun napautat päivää päiväennusteessa, sen tunnit avautuvat päivän alle (tänään nykyhetkestä alkaen, muut päivät klo 07 kohdalta). Tunnin valinta pitää päivän auki, uusi napautus sulkee sen. Napautus ei enää vie sivua tekoälykortille.
- Muutokset käyttöliittymän katseluun: kaaviot, ilmoitukset, varoitukset, asetukset ja chat toimivat myös vaalealla teemalla.

## 0.3.2 – UI- ja UX-arvioiden korjaukset

- Vastauskaista: takki ja sateenvarjo aina kahdessa sarakkeessa, tutkalause niiden alle; huomiokaista näyttää vakavimman täysrivinä ja loput yhtenä tiivistettynä rivinä. Vastaus mahtuu 360 px:n ruudulle.
- Uusi Tänään/Huomenna-valinta vastauskaistan otsikossa; chat-ehdotukset päivitetty.
- Sateenvarjokaistan teksti kertoo, mihin asti sadetta ei ole ja milloin seuraava sade alkaa ("ei sadetta klo 21 asti · seuraava sade huomenna klo 00"). Sadejaksojen päättymisaika on sama kaikissa teksteissä.
- Jos virallisia varoituksia ei voitu tarkistaa (yhteysvirhe, vanhentunut peili, offline), etusivu kertoo sen ja linkittää Ilmatieteen laitoksen varoituksiin.
- Paikannimen tunnistus: pienellä kirjoitettu sana ("lapsen", "kotona") ei enää tulkitu paikaksi, paikallissijat ("lapuassa", "lahdessa") toimivat.
- Valintapainikkeiden korkeus 44 px.

## 0.3.1 (2026-11)

Korjaukset

- **Viralliset varoitukset toimivat nyt.** Puhelimen diagnostiikka osoitti, ettei Ilmatieteen laitoksen syöte (`alerts.fmi.fi`) salli selaimen suoraa hakua. GitHub Actions hakee syötteen itse neljännestunnin välein (`.github/workflows/mirror-warnings.yml`, `tools/mirror-warnings.mjs`) ja tallentaa tiivistelmän haaraan `warnings-data`; sovellus lukee sen osoitteesta `raw.githubusercontent.com` (CSP päivitetty) ja valitsee oman alueen laitteella. Peili tarkistetaan tarkasti (muoto, koordinaattirajat, koot), yli kuusi tuntia vanhaa ei käytetä, ja tyhjää peiliä ei kirjoiteta, jos syötteen muoto näyttää muuttuneen.
- Peili on testattu oikealla Ilmatieteen laitoksen aineistolla (17.11.2026: 7 varoitusta, 590 kt; liikennesää- ja merituulivaroituksia). Koko-, alue- ja pistemäärärajat mitoitettiin sen mukaan reilusti yläkanttiin, ja testeissä on pieni oikea näyte.
- **Diagnostiikka erottaa vian syyn**: palvelu vastaa mutta selain ei saa lukea sitä (CORS), tietoturvapolitiikka (CSP) esti haun, ei yhteyttä, HTTP-virhe tai virheellinen peili.
- Gemini-avaimen kenttä: avain tarkistetaan (välilyönti ja erikoismerkit eivät tallennu), tallennuksen epäonnistuminen kerrotaan, kenttä ei ole salasanakenttä, ja tekoälyvastausten välimuisti on rajattu 50 vastaukseen.

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
