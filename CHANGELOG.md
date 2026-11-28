# Muutosloki

## 1.0.0 – Suosikkipaikat, ilmanlaatu ja siitepöly, saavutettavuus

Uutta

- **Suosikkipaikat.** Paikkapaneelissa voi tallentaa tähdellä enintään kahdeksan paikkaa; talo merkitsee kodin, joka on aina ensimmäisenä. Jokaisesta suosikista näkyy nykyinen lämpötila ja sää (kaikki yhdellä kevyellä haulla, vasta kun paneeli avataan). Äsken katsottu paikka avautuu heti muistista ja päivittyy taustalla. Chat tunnistaa suosikit nimeltä, myös taivutettuna ("Särkisalossa").
- **Ilmanlaatu, siitepöly ja UV** (Open-Meteo / CAMS). Kotisivulla pienet pillerit otsikon alla vain, kun niillä on merkitystä (siitepöly kohtalainen tai enemmän, ilmanlaatu huono, UV 3 tai yli). Huono ilmanlaatu ja erittäin runsas siitepöly näkyvät SääÄlyn huomiona varoitusrivillä. Tunnit-sivun avattu tunti näyttää ilmanlaadun, UV:n ja siitepölyn lajeittain (leppä, koivu, heinät, pujo, tuoksukki) neuvoineen, ja Viikko-sivun päivä kertoo runsaan siitepölyn ja UV:n.
- Chat vastaa siitepöly-, ilmanlaatu- ja UV-kysymyksiin omalla laskennalla ("Kukkiiko koivu huomenna?", "Tarvitsenko aurinkovoidetta?"). Gemini saa samat tiedot.
- **Pikakuvakkeet.** Aloitusnäytön kuvaketta painamalla pitkään pääsee suoraan chattiin, karttaan, Tunteihin tai Viikkoon.
- **Ilman verkkoa** sovellus kertoo selvästi: "Ei verkkoyhteyttä. Näytetään ennuste klo 9.05 (2 h sitten)."

Laatu ja korjaukset

- Mallivertailu näytti aukon jälkeen edellisen tunnin luvut; "nyt" saattoi hypätä ennusteen loppuun, jos nykyinen tunti puuttui datasta.
- Viikon sateen todennäköisyys painottaa malleja samoin kuin sateenvarjoneuvo, joten sivut eivät enää ole eri mieltä.
- Tutkan "seuraava tunti" on tunti myös silloin, kun tutka antaa 15 minuutin välein.
- Chat ei enää väitä datasta puuttuvaa tuntia ennusteen ulkopuoliseksi.
- Paikkahaku kestää virheelliset vastaukset; nimettömiä tai koordinaatittomia tuloksia ei näytetä.
- Nopea paikan vaihto: edellisen paikan nimi, tutka tai havainto ei enää jää uuden paikan päälle eikä viivästytä sitä. Rikkinäinen välimuisti ei pysäytä automaattista päivitystä.
- Varoitustiedon kellonaika näytetään paikan ajassa, ei puhelimen aikavyöhykkeessä.

Saavutettavuus ja suorituskyky

- Kaikki näkymät läpäisevät axe-tarkistuksen (WCAG 2.2 AA) ilman huomautuksia: painikkeiden nimet alkavat näkyvällä tekstillä, etusivun otsikko on otsikko ruudunlukijalle, kartan välilehdet on merkitty oikein. Pieni toissijainen teksti on hieman tummempi (vaalea teema) ja vaaleampi (tumma teema), jotta kontrasti riittää kaikilla taivailla.
- Taivasanimaatio piirtyy tasaisella tahdilla eikä herää taustalla, kun chat tai kartta on auki (chatissa kirjoittaminen kuormittaa suoritinta murto-osan entisestä). Kuution kääntö tekee noin kolmanneksen entisestä työstä, ja kartta ei toista kehyksiä piilossa.
- Service worker tallentaa jokaisen tiedoston vain kerran (osoitteen parametrit eivät kasvata välimuistia), ei tallenna osittaisia vastauksia ja käyttää navigoinnin esilatausta.

## 0.8.0 – Koko näytön kuutio, tutka ja pilviennuste kartalla

Kuutio

- **Koko näyttö kääntyy.** Kuution kyljet ovat nyt koko näytön kokoisia: taivas, yläpalkki, ilmoitukset, varoitukset ja alapalkki kääntyvät sivun mukana, ja kuution ympärillä näkyy syvä tausta. Levossa näkymä on ennallaan.

Kartta

- **Tutka ja Pilvet.** Alapalkin uusi karttapainike (Kysy SääÄlyltä -pillerin vieressä) avaa koko näytön kartan. Tunnit-sivun tutkakortissa on lisäksi Kartta-painike.
- **Tutka** näyttää havaitun sateen viimeisen kahden tunnin ajalta 20 minuutin välein (RainViewer). Kehykset toistuvat automaattisesti, ja liukusäätimellä voi valita ajan ("klo 13.30 · uusin", "klo 11.30 · 2 t sitten").
- **Pilvet** näyttää säämallien pilvisyyden ja sateen seuraavalle vuorokaudelle tunneittain (Open-Meteo, noin 40–60 km:n ruudukko, lähelle zoomatessa tiheämpi). Lumi näkyy omalla värillään.
- Kartta liikkuu sormella ja zoomautuu nipistämällä, kaksoisnapautuksella tai painikkeilla. Keskitä-painike palauttaa oman paikan keskelle.
- Pohjakartta (rannikot, järvet ja rajat) tulee sovelluksen mukana (Natural Earth): Pohjoismaat tarkkana, muu Eurooppa karkeampana. Karttapohjaa ei siis haeta karttapalvelusta.
- Kartta sulkeutuu ×:stä, Esc-näppäimellä ja Androidin takaisin-eleellä.

Korjaukset

- Asetusten, chatin tai kartan sulkeminen Tunnit-, Viikko- tai Varmuus-sivulla ei enää palauta Kotiin.

## 0.7.1 – Sivukuutio

- **Sivut ovat nyt kuution kyljet.** Koti, Tunnit, Viikko ja Varmuus ovat näytön kokoisen kuution neljä kylkeä. Kuutio kääntyy sormen mukana; irrotus kääntää sen lähimmälle kyljelle ja nopea pyyhkäisy seuraavalle. Kuutio jatkaa ympäri: Varmuudesta eteenpäin tulee Koti ja Kodista taaksepäin Varmuus.
- Kääntyessään kyljet ovat pehmeäkulmaista huurrelasia, jossa on vaaleat reunat ja varjostus. Levossa sivu on litteä ja teksti terävä kuten ennenkin. Alapalkin pisteet seuraavat kääntöä, ja pisteistä kuutio kääntyy lyhintä reittiä.
- Sivujen vieritys, vedä päivittääksesi, päivän tuntinauha ja sääkaavio toimivat kuten ennenkin. Veto ei ole napautus, joten kääntö ei valitse radalta tuntia. Piilossa olevat kyljet eivät ole ruudunlukijan eivätkä sarkaimen ulottuvilla.
- Kun puhelimessa on valittu vähemmän liikettä, sivu vaihtuu häivyttäen ilman 3D-kääntöä.

## 0.7.0 – Arvion korjaukset: neljä sivua ja selkeämpi etusivu

Etusivu

- **Otsikko kertoo ensin olennaisen.** Kuivana päivänä takkisuositus ja mihin asti on kuivaa ("Välikausitakki tai tuulitakki. Kuivaa koko päivän."), sateella sateenvarjo ja sateen todellinen alkamis- tai loppumisaika ("Sade alkaa klo 16."). Kun tutkaennuste on käytettävissä, aika tulee tutkasta minuutteina ("Sade alkaa noin 20 min kuluttua."). Pieni lisärivi kertoo liukkauden, puuskat tai seuraavan sateen ("Seuraava sade ma klo 11.").
- Sankarissa on tämän päivän alin ja ylin lämpötila; maakunta näkyy yläpalkissa paikan alla.
- **Huomenna** vaihtaa koko etusivun huomiseen: otsikko, sankari ja rata alkavat huomisaamusta.
- Radan tunnin napautus näyttää tunnin tiedot sankarissa samalla sivulla; "×" palaa nykyhetkeen.
- Etusivu mahtuu yhdelle ruudulle myös 360 px:n puhelimessa kahden varoituksen kanssa. Hyvin lyhyellä ruudulla sivu vierii, eikä mikään jää alapalkin alle.
- Etusivulta poistettiin SääÄly kertoo -kortti, faktakortti, mallirivi, sääkaavio, kuivan sään tutkarivi ja "Lisää Gemini-avain" -painike. Ne löytyvät nyt omilta sivuiltaan tai asetuksista.
- **Varoitusrivi**: viralliset varoitukset värirenkaalla, omat huomiot katkoviivalla, tiivis kaksirivinen yhteenveto (alue, lähde ja teksti avautuvat napautuksella). Jos varoituksia ei voitu tarkistaa tai tieto on yli 90 minuuttia vanha, näkyy pieni merkki "Varoitustieto klo 4.24 · tarkista Ilmatieteen laitokselta".

Sivut

- **Neljä pyyhkäistävää sivua**: Koti, Tunnit, Viikko ja Varmuus. Alapalkin pisteet näyttävät sivun ja vievät suoraan sinne; Androidin takaisin-ele palaa kotisivulle. Ensimmäisellä kerralla vihje kertoo pyyhkäisystä.
- **Tunnit**: 13 tuntia ja painike "Näytä 48 tuntia". Rivin napautus avaa tunnin tiedot paikallaan (tuntuu kuin, tuuli ja puuskat, sade, pilvisyys ja mallien ero, lähimmän aseman havainto, "Kysy tästä tunnista"). Lista/Kaavio-valinta; sääkaaviossa 3D-sääkuvakkeet. Kun sade on alle kahden tunnin päässä, tutkan sadekäyrä näyttää seuraavat 2 tuntia. Tyhjät 0 %:n palkit ja viivat poistettiin.
- **Viikko**: otsikko kertoo viikon suunnan ja sadepäivät ("Pakkanen hellittää lauantaina."), viikonlopun yhteenveto ja liukkaat päivät. Lämpötilavälit kromikapseleina; päivän napautus avaa sen tunnit.
- **Varmuus**: yksi mittari tänään ja huomenna (luotettava, melko luotettava, epävarma) ja kahdeksan helmeä, yksi kullekin mallille sen mukaan, paljonko malli poikkeaa SääÄlyn ennusteesta. Teksti kertoo, mistä epävarmuus tulee ("sade alkaa klo 15–17 mallista riippuen"). Lähimmän sääaseman havainto kertoo, osuuko ennuste juuri nyt.

Chat ja asetukset

- Chatin lähdevalitsin siirtyi asetuksiin (Lisäasetukset). Chatissa lukee "Vastaa: Oma laskenta · vaihda".
- Chat aukeaa yhteenvedolla nykyhetkestä; uudet kysymysehdotukset (seuraava sade, huominen, viikonloppu, lenkki, toinen paikkakunta).
- Asetukset uudessa järjestyksessä: päivitys ja sijainti, pukeutuminen, päivitysväli, ulkoasu ja tiedot. Lisäasetuksissa ovat vastausten lähde, Gemini ja diagnostiikka.

Ulkoasu

- Inter Display -fontti (tulee sovelluksen mukana, OFL-lisenssi), täysmittainen miinusmerkki ja tummempi toissijainen teksti, jotta pieni teksti erottuu vaalealla taivaalla.
- Ei laatikoita: kromipunos tuntilistassa, kromikapselit viikossa ja 3D-helmet varmuudessa. Paneelit, painikkeet ja sääkaavio uudistettu samaan tyyliin.
- Hämärä on sininen hetki eikä harmaa; sade on rauhallisempi ja harvempi.

Uusi lähde

- **Lähimmän sääaseman havainto** Ilmatieteen laitoksen avoimesta datasta (enintään 35 km:n päästä ja 90 minuuttia vanha). Näkyy Tunnit- ja Varmuus-sivuilla, jos palvelu sallii selaimen haun; muuten sovellus toimii ilman sitä.

Korjaukset

- Keskiyö: teksteissä "keskiyöllä" ja "keskiyöhön", sarakkeissa tunnit kahdella numerolla (23, 00, 01).
- Tunnit-sivun otsikko käyttää tutkaa samoin kuin etusivu, joten sivut eivät kerro sateesta eri aikoja.
- Sumun taustan piirtovirhe korjattu.
- Selaimen vaaraton ResizeObserver-ilmoitus ei enää avaa virhenäyttöä.

Ei vielä tässä versiossa

- Tutkakartta. Ilmatieteen laitoksen karttatasoja ja sopivaa taustakarttaa ei voitu varmistaa toimiviksi, joten kartta tulee myöhemmin. Tutkan sadekäyrä on Tunnit-sivulla.

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
