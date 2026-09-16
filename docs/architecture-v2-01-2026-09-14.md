# WP-ELEVENTY-MIGRATOR-ARCHITECTURE-V2-01

Status: **§2 ja §3 LOCKED (2026-09-14)** — design-päätökset ja
auditin 5 avoimen kysymyksen vastaukset on hyväksytty
ChatGPT-katselmuksessa 2026-09-14 täsmennyksin. Katselmus tapahtui kahdessa
kierroksessa; toisen kierroksen täsmennykset on merkitty §2- ja §3-
alakohtiin. Modulointi-vaihe 1 (§5) voidaan aloittaa kun testirunko ja
golden fixture 1 ovat scope-määriteltyjä.

Baseline: engine `scripts/wp-eleventy-migrate.mjs` @ commit `d68ddf78`
(2026-03-15), **5 287 riviä** ESM-monoliitissa. Ks. `CLAUDE.md`.

Vastaa auditti-dokumenttien identifioimiin puutteisiin:

- `docs/wp-eleventy-migrator-audit-01-2026-09-14.md` — 3 × P0 + 6 × P1 + 5 avointa päätöstä
- `docs/jaali-eu-migration-source-audit-01-2026-09-14.md` — konkreettinen non-Kadence testitapaus (WPBakery + Slider Revolution)

Scope-suunta: **aidosti geneerinen WordPress → Eleventy -migraattori.**
WP kuolee migraation jälkeen (one-shot). Kohde: Eleventy + Nunjucks -natiivi.

---

## 1. Ongelmalauseke

Nykyinen engine on **kalibroitu Kadence-lähteille** (audit §6.1) mutta markkinoi
itseään geneerisenä. Konkreetti evidenssi kalibraatio-virheestä on
`jaali.eu`-auditissa: WPBakery + Slider Revolution + Total-teema tuottaisi
käyttökelvottoman etusivun (`[vc_row]`-tekstiä + `<rs-module>`-massaa) nykyapurin
läpi ajettuna.

Kaksi rakenteellista ongelmaa estävät korjauksen ilman refaktorointia:

1. **5 287-rivinen monoliitti** — code review, testaus, ja modulaarinen
   laajennus (esim. WPBakery-parseri kolmantena block-tyyppinä Kadencen ja
   Kadence-Pron rinnalle) vaativat kaikki koko tiedoston lukemista.
2. **Suljettu preset-järjestelmä** (audit P1-1) — enum + switch, ei
   `configs/presets/*.json` -pluginia. Uusi kohdeprojekti = editoi engineä.

Tämä dokumentti ehdottaa (a) design-päätökset, jotka rajaavat suunnan, ja
(b) modulointi-kartan, joka jakaa monoliitin ~28 moduuliin ennen P0-työn
aloittamista. Molemmat pitää validoida ennen koodauksen aloittamista.

---

## 2. Design-päätökset (LOCKED 2026-09-14)

Kolme päätöstä on lukittu ChatGPT-katselmuksessa 2026-09-14. §2.2 ja §2.3
sisältävät katselmuksen tuomat täsmennykset alkuperäiseen ehdotukseen.
Vaihtoehdot ja trade-offit säilytetään dokumentaatiosyistä.

### 2.1 Päätös #2 — Output-formaatti: Markdown + frontmatter

**Lukittu (täsmennyksin).** Content-tiedostojen ensisijainen output-formaatti
on **Markdown YAML-frontmatterilla** (tavanomainen Eleventy). `_data/*.json`
varataan vain **site-wide datalle** (navigaatio, taksonomia-luettelot,
käännöspaketit) — ei sisältöobjekteille.

**`.md`-tiedoston body saa sisältää säilytettyä raakaa HTML:ää.** Markdown ja
HTML eivät ole toisensa poissulkevia — CommonMark sallii inline-HTML:n, ja
tämä on legitiimi tapa säilyttää sisältö jota ei voida turvallisesti muuntaa
Markdowniksi. **Taulukot, monimutkaiset kuvamerkinnät, ei-triviaali
`<figure>`-rakenne tai muut vaikeat HTML-fragmentit eivät automaattisesti
vaadi transformer-moduulia** — ne voivat elää `.md`-bodyssä raakana HTML:nä.
Transformer tarvitaan vain silloin kun jokin ulompi teknologia (Kadence,
WPBakery, Slider Revolution) vaatii uudelleen-mappaamista Nunjucks-
partial-kutsuun.

**Perustelu.**

- Eleventy-yhteisön kanoninen tapa. Uudet sivustot, teemat ja pluginit olettavat
  Markdown-content-pinoa.
- Sisältö säilyy ihmisluettavana ilman rendaus-vaihetta (git-diff, editointi,
  copy-paste ovat kaikki lähtöformaatista suoraan).
- Frontmatter mappautuu 1:1 Eleventyn front matter -kenttiin ilman
  `_data/`-välikerrosta.
- HTML-inline `.md`-bodyssä pitää generic core -kerroksen konservatiivisena:
  se ei ole velvoitettu muuntamaan mitään mitä se ei osaa muuntaa turvallisesti.

**Vaikutukset.**

- Kadence-preset tuottaa nykyisin `.njk`-tiedostoja (`{% include %}`-blokki-
  puita). Tämä säilyy `.njk`:na, mutta on preset-tason **opt-in-poikkeus**, ei
  default. Perus-content on Markdown ellei blokki-transformeri vaadi
  Nunjucksia.
- Poistaa `_data/posts.json`-kaltaisen kollektion tuottamisen (ei koskaan
  tuotettukaan — todennettu engineä lukemalla).
- **Nunjucks-syntaksi `.md`-tiedostossa edellyttää kohdeprojektin Markdown-
  template enginen konfigurointia Nunjucksiksi** (Eleventyssä
  `markdownTemplateEngine: "njk"`). **Migraattori ei tuota, ylikirjoita tai
  oleta kohteen Eleventy-konfiguraatiota.** Kohdeprojektilla voi olla eri
  konfiguraationimi, Eleventy-versio, olemassa oleva konfiguraatio tai omat
  rakennekonventiot — mikään näistä ei ole migraattorin tiedossa eikä sen
  vastuulla. Linjaus:
    (a) **Jos** migraatio tuottaa `.md`-bodyyn Nunjucks-syntaksia (mikä tahansa
        transformer-output), migraattori kirjaa vaatimuksen
        `migration-report.json`in `targetSetupNotes`-kohtaan: kohteen Markdown-
        template engine on konfiguroitava Nunjucksiksi ennen ensimmäistä
        buildia. Merkintä sisältää affected-file-listan ja on näkyvä
        varoitus, ei informatiivinen huomautus.
    (b) Migraattori **voi valinnaisesti** tuottaa erillisen **opt-in-ohje-
        tai snippet-tiedoston** (esim. `TARGET-SETUP.md` output-hakemistossa)
        joka esittää esimerkin `markdownTemplateEngine`-asetuksesta ja
        ohjeen sen liittämisestä kohteen olemassa olevaan konfiguraatioon.
        **Tämä ei ole Eleventy-konfiguraatiotiedosto** — sen tiedostonimi ja
        sisältö on valittu niin, ettei se voi tulla luetuksi Eleventy-
        toolchainin osana eikä ylikirjoittaa kohteen asetuksia. Opt-in
        config-flägillä (`emitTargetSetupNotes: true`), ei default.
    (c) **Default-output ei edellytä kohdeprojektin konfiguraatiomuutosta.**
        Jos yhtään transformeria ei ole päällä, migraattori tuottaa vain
        Markdownia ja §2.1-mukaisesti säilytettyä HTML:ää, jotka mikä tahansa
        Eleventy-versio renderöi ilman erikoisasetuksia. Nunjucks-vaatimus
        syntyy **vain** transformer-vaiheessa, ei perusajolla.

**Vaihtoehdot ja miksi ei.**

- **A: HTML-passthrough default.** Yksinkertaisin, mutta rikkoo Eleventy-
  konvention ja tekee editoinnista raakaa HTML:ää.
- **B: `_data/*.json` -pohjainen collection-pino.** Toimii, mutta menettää
  frontmatterin luonnollisen editointi-ergonomian ja pakottaa layout-tason
  loopin kaikelle contentille.

### 2.2 Päätös #3 — Kaksivaiheinen HTML-käsittely

**Lukittu (täsmennyksin).** Sisällönmuunnos jaetaan kahteen kerrokseen:

1. **Generic core (aina päällä).** **Lähde-agnostinen** — ei oleta Gutenberg-
   lohkoja, ei Kadencea, ei WPBakerya, ei Elementoria eikä mitään muutakaan
   spesifistä page builder- tai teema-teknologiaa. "Block-by-block" tässä
   yhteydessä tarkoittaa **tunnistettua lähdesisältöyksikköä** — mikä tahansa
   yksikkö johon lähdesisältö luonnostaan segmentoituu (Gutenberg-lohko,
   HTML-block-element, shortcode, `<!-- comment -->`-delimitoitu alue, tai
   yksinkertaisimmillaan koko dokumentti yhtenä opaakkina yksikkönä).

   **Markdown-muunnos on konservatiivinen.** Generic core muuntaa
   Markdowniksi vain **turvallisesti tunnistetut rakenteet** —
   yksiselitteiset otsikko-tasot, kappaleet, korostukset, yksinkertaiset
   listat, yksitasoiset linkit ja kuvat perusattribuuteineen. **Tuntematon,
   attribuuttirikas tai muuten monimutkainen sisältö säilytetään alkuperäisenä
   yksikkönä** — raakana HTML:nä `.md`-bodyssä (§2.1). Tämä koskee esimerkiksi
   taulukoita, sisäkkäisiä listoja class-attribuutein, `<figure>`+`<figcaption>`-
   rakenteita, `<video>`-elementtejä ja tuntemattomia HTML-tageja. **Ei
   heuristisia lossy-muunnoksia.**

2. **Opt-in transformerit.** Erilliset moduulit, jotka rekisteröivät
   tunnistus-predikaatin ("hallitsen [vc_*]-shortcodet" / "hallitsen
   `<!-- wp:kadence/* -->`-lohkot" / "hallitsen `<rs-module>`-elementit") ja
   render-funktion joka tuottaa Nunjucks-shortcoden tai -makron. Käynnistetään
   config-flägillä (`transformers: ["kadence", "wpbakery", "slider-revolution"]`).
   Transformer-ketjun output on Nunjucks-partial-kutsu; core-kerros näkee sen
   opaakkina ja säilyttää sen sellaisenaan.

**Transformer-sopimus (pakollinen invariantti).** Jos transformer on
konfiguroitu päälle mutta **ei hallitse** kohtaamaansa yksikköä (esim.
`kadence`-transformer näkee `[vc_row]`-shortcoden), sovelletaan seuraavat
säännöt:

- **Alkuperäinen yksikkö säilytetään sellaisenaan** — samalla polulla ja
  kontekstissa jossa se oli lähdesisällössä. Ei uudelleen-järjestelyä, ei
  pudottamista.
- **Osittainen muunnos on kielletty.** Transformer joko tuottaa täydellisen
  render-outputin yksikölle tai luovuttaa yksikön käsittelemättömänä.
  Puolivalmis "tunnistin outer wrapperin mutta en sisältöä"-tila ei ole
  hyväksyttävä lopputulos.
- **Sisältöä ei koskaan hävitetä.** Jos transformer aikoisi kirjoittaa
  yksikön päälle, mutta joutuu luovuttamaan, alkuperäinen palautetaan
  ennen kirjoitusta.
- **Migration-report saa näkyvän varoituksen.** Kentässä
  `actionItems.unhandledUnits[]` on merkintä:
  `{ transformer, unitType, sourceLocation, snippet, reason }`.
  Coverage-metriikkaan (§5, P0-3) lasketaan `unhandledUnits`-suhde
  kokonaisyksikkömäärästä.

Tämä invariantti on **testattavissa** golden fixtureilla (§5): syötetään
lähdesisältö jonka transformer ei hallitse, ja verifioidaan että output-body
on identtinen sen kohdan osalta lähteen kanssa ja että warning-kirjaus
esiintyy `migration-report.json`issa.

**Perustelu.**

- Nykyisin Kadence on kietoutunut sekä `parseWpBlocks`-tokenisointiin että
  `renderBlockTree`-outputiin (`:2891`, `:3038`). WPBakery-tuen lisääminen
  samaan mustaan laatikkoon tuottaisi kolmannen `if preset === "wpbakery"`
  -haaran ja kasvattaisi kompleksisuutta.
- Erottelu antaa "aidosti geneerinen"-lupauksen konkreettisen mittarin:
  **generic core toimii ilman yhtään transformer-flägiä**, tuottaa Markdownia
  tai puhdasta HTML:ää ja pysyy ~200-rivisenä. Transformerit ovat
  laajennusrajapinta.
- Uusi kohde-CMS-teknologia (Elementor, GenerateBlocks, Spectra) = uusi
  moduuli `src/blocks/<name>.mjs`, ei muutosta enginessä.

**Vaikutukset.**

- Nykyinen Kadence-koodi (18 core + 14 Pro-blokkia + parser + renderer +
  partial-generator) siirtyy transformer-moduuliksi
  `src/blocks/kadence.mjs`. Kadence-preset kytkee sen päälle.
- WPBakery- ja Slider-Revolution -transformerit ovat P1-tason lisäyksiä
  jaali.eu-migraation edellytyksinä (jaali-audit §6.3).
- `unknownKadenceBlockStrategy` yleistyy `unknownBlockStrategy`-flägiksi ja
  koskee kaikkia transformer-ketjuja.

**Vaihtoehdot ja miksi ei.**

- **A: Yksi iso block-parser joka tunnistaa kaikki teknologiat.** Yhdistetty
  AST helpottaisi cross-teknologia-analyysia mutta kasvattaa moduulin ~300
  riviin per uusi block-perhe ja tekee testauksesta hankalaa.
- **B: Puhdas HTML-passthrough kaikelle, ei transformereita.** Vaatii Eleventy-
  puolelle ajonaikaisen HTML-parserin ja rikkoo Markdown-defaultin (§2.1).

### 2.3 Auth-default

**Lukittu (täsmennyksin).** Autentikoinnin oletus muutetaan seuraavaksi:

- **Ensisijainen:** REST + WordPress **Application Password** (core-ominaisuus
  WP 5.6+). Header `Authorization: Basic <base64(user:app-password)>`.
- **HTTPS pakollinen** kaikelle authentikoidulle liikenteelle. Migraattori
  **kieltäytyy** ajamasta `app-password`- tai `bearer`-moodissa `http://`-
  URLia vastaan — vain `https://` on hyväksytty. Käyttäjä saa selkeän
  virhesanoman, ei silent-fallbackia julkiseen REST:iin.
- **Salaisuudet vain ympäristömuuttujissa tai käyttöjärjestelmän avaimen-
  perässä** (macOS Keychain, Linux Secret Service, Windows Credential
  Manager). **Ei koodissa, ei `configs/*.json`-tiedostoissa, ei komento-
  rivi-argumenteissa.** Wizard ja UI hyväksyvät salaisuuden vain
  interaktiivisesti tai `WP_APP_PASSWORD`-tyyppisen env-varin kautta;
  arvo maskataan lokeissa ja `migration-report.json`:ssa.
- **Julkinen REST** vain **sniff-testinä** analyzevaiheessa (`analyzeSite`,
  `:1434`) — todetaan mitä endpointtejä on auki ja mitkä vaativat authin.
  Ei ensisijainen migraation ajoreitti.
- **XML-export** (`wp-admin/export.php`) on **oletuksena pakollinen
  preflight-portti** ennen REST-fetchin aloittamista. Migraatio kieltäytyy
  aloittamasta jos `xmlBackup.filename` puuttuu configista. Manifest-lohko
  `xmlBackup` `migration-report.json`issa on **onnistuneen preflightin
  jälkeen** muotoa:
  - `status: "verified"`
  - `filename` — annettu tiedostopolku
  - `sizeBytes` — todellinen tiedostokoko
  - `sha256` — sisällön checksum
  - `verifiedAt` — ISO-8601-aikaleima jolloin migraattori luki ja varmisti
    tiedoston olemassaolon ja koon ennen REST-fetchin aloittamista

  **Ohitus vain nimenomaisella `--skip-xml-backup`-valinnalla** (dokumentoitu
  vaarallisena). CLI:ssä flägi on eksplisiittinen; UI:ssa ohitus vaatii
  **kirjoitetun vahvistuksen** (käyttäjän on kirjoitettava
  `SKIP-XML-BACKUP` tekstikenttään, ei yhtä klikkausta). Ohituksen
  tapauksessa `migration-report.json`in `xmlBackup`-lohko on muotoa:
  - `status: "skipped"`
  - `skippedAt` — ISO-8601-aikaleima
  - `warning` — kiinteä varoitusteksti joka näkyy myös raportin ylätason
    `warnings`-listassa ja UI:n loppunäkymässä

  **Pelkkä käyttäjän ilmoitus "olen ottanut backupin muuta kautta" ei
  ole teknisesti hyväksytty varmistus.** Migraattorin ainoa positiivinen
  varmennus on preflight-portti oikeaa tiedostoa vasten (checksum + koko).
  Kaikki muu on `status: "skipped"`.

**Perustelu.**

- Application Password on WP-core-ominaisuus (ei plugin-riippuvuutta), ei
  kaipaa OAuth-flowta, ei nonce-hässäkkää. Tukee `context=edit`-parametria
  joka **voi paljastaa autentikoidulle käyttäjälle saatavilla olevia
  metakenttiä** — mukaan lukien Yoast SEO -pluginin `_yoast_wpseo_*`
  -postmeta-kentät, drafts, revisiot ja custom-metaboxien private-kentät
  (jaali-audit §6.2). **Tämä ei kuitenkaan takaa täydellistä Yoast-meta-
  näkymää**: näkyvyys riippuu pluginin capability-rekisteröinneistä ja
  käyttäjän rooleista. `yoast_head_json` on tähän täydentävä (ei
  korvaava) julkisen fetchin kautta saatava dataus, jota kannattaa
  hyödyntää kanonisiin OG-/schema-kenttiin.
- Julkinen REST vuotaa väistämättä tuntemattomasti — `authentication: []`
  REST-index-endpointissa kertoo että endpoint-tason auth on tyhjä, mutta
  yksittäiset kentät (esim. Yoast `meta`) vaativat silti `context=edit`-
  autentikoinnin.
- XML-export on ainoa REST-riippumaton **sisältövarmistus**. **Se ei ole
  täydellinen WordPress-palautus:** WXR-formaatti kattaa postit, sivut,
  taksonomiat, kommentit ja metatiedot, mutta **ei** sisällä media-tiedostoja
  binäärinä (vain viittaukset), ei teematiedostoja, ei plugin-koodia, ei
  wp-config-asetuksia, ei tietokantatason lisärivejä (Wordfence-lokit,
  transient-cache), eikä palvelinpuolen konfiguraatiota (nginx, PHP-versio,
  .htaccess). **One-shot-migraatiossa** — jossa WP dekomissioidaan
  migraation jälkeen — tämä tarkoittaa että:
  - **Migraattorin lataamat mediat ovat sisällön palautettavuudelle
    olennaisia**, ei ainoastaan kohde-Eleventy-repon rakennustarpeille.
    `media/`-hakemiston säilyminen migration-outputissa on ensimmäisen
    prioriteetin backup, ei rakennus-side effect.
  - **Migraatio-manifesti** (`migration-report.json` + `migration-config.json`)
    yhdessä ladattujen medioiden ja XML/WXR-exportin kanssa muodostaa
    tosiasiallisen palautuspaketin. Näiden kolmen tallentaminen erilliseen
    turvakopio-sijaintiin on käyttäjän vastuulla.
  - **Teema, pluginit ja palvelinpuolen tila** edellyttävät **erillistä
    varmistusta** (esim. `wp-content/`-tar.gz + tietokannan mysqldump),
    jota migraattori ei tuota ja jota käyttäjä on vastuussa ottamaan
    itse ennen dekommissiointia. Migraatio-doc listaa tämän
    action-item-listalle.

**Vaikutukset.**

- Wizardin auth-askel muuttuu: `app-password` on default (aiemmin `none`).
  Julkinen REST vaatii nyt tietoisen valinnan ja näyttää varoituksen puuttuvista
  kentistä (Yoast meta, revisiot, drafts).
- `configs/*.json` ei-taaksepäin-yhteensopiva vain jos `authMode` on
  aiemmin ollut oletuksena. Nykyisistä 3:sta config-esimerkistä
  (`generation-ai-stn.fi.*.json`) tarkistus tehdään koodauksen aikana.
- `runMigration`in alkuun lisätään **XML-export-preflight-portti (blokkaava)**:
  jos `xmlBackup.filename` puuttuu configista, migraatio kieltäytyy
  aloittamasta. Ohitus vain `--skip-xml-backup`-flägillä (CLI) tai
  kirjoitetulla vahvistuksella (UI); molemmat kirjautuvat `warnings`-listaan
  ja `xmlBackup.status: "skipped"` -manifest-lohkoon (ks. yllä).

**Vaihtoehdot ja miksi ei.**

- **A: JWT/OAuth-plugin default.** Vaatii pluginin (JWT Authentication for
  WP REST API, WP OAuth Server) — rikkoo geneerisyys-lupauksen.
- **B: Public REST default kuten nyt.** Toimii jaali.eu:n kaltaisilla
  julkisilla siteillä mutta menettää Yoast meta -kenttiä ilman
  `context=edit`iä. Ei-taaksepäin-yhteensopiva ei ole ongelma jos päätetään
  että audit §2.1-tason P0-työ vaatii uudelleen-konfiguroinnin joka
  tapauksessa.

---

## 3. Vastaus auditin avoimiin kysymyksiin (LOCKED 2026-09-14)

Auditin §4:n 5 avointa kysymystä on vastattu ja vastaukset lukittu
ChatGPT-katselmuksessa 2026-09-14. Vaihtoehdot ja trade-offit säilytetään
dokumentaatiosyistä. Yhteenvetotaulukko:

| # | Auditin kysymys | Lukittu vastaus |
|---|---|---|
| 4.1 | Kohdeprojekti-kirjo (preset-laajennus)? | **Presetit ovat versionoituja ja skeemavalidoituja konfiguraatiokerroksia.** Ks. §3.1. |
| 4.2 | Kadence-Pro-jako (14 lisäblokkia)? | **Transformer-kohtainen `options`-asetus.** Ks. §3.2. |
| 4.3 | Markdown vs. HTML-passthrough? | **Markdown default, HTML fallback yksikkötasolla.** Ks. §3.3 ja §2.1. |
| 4.4 | YAML-korjaus root-cause? | **Koko frontmatterin serialisointi `js-yaml`illa.** Ks. §3.4. |
| 4.5 | Multilingual-mallin syvyys? | **Relation adapter -pohjainen, kaikki kielet samassa ajossa.** Ks. §3.5. |

### 3.1 Kohdeprojekti-kirjo — preset-laajennus (audit §4.1)

**Lukittu.** Presetit ovat **versionoituja ja skeemavalidoituja
konfiguraatiokerroksia** hakemistossa `configs/presets/*.json`, **eivät
kohdesivustojen nimiä**. Bespoke-nimet (kuten "total", "jaali",
"generation-ai-stn") ovat kiellettyjä preset-tasolla; ne kuuluvat
sivustokohtaisiin `configs/<hostname>.json`-tiedostoihin, jotka **viittaavat**
presettiin.

Preset-tiedosto sisältää:

- `$schemaVersion` — pakollinen (`"1"` ensimmäisessä versiossa).
- `transformers` — lista transformer-kohtaisia asetuksia (ks. §3.2).
- `styles` — tyylikäsittelyn ohje (`stylesDir`, `migrateStyles`).
- `auth-hint` — **vain UI-ohjaava** vihje (`preferredAuthMode`,
  `xmlBackupRecommended`). **Ei saa sisältää salaisuuksia** (paikka,
  jossa käyttäjän `Application Password` kirjoittautuisi presettiin, on
  siis kielletty skeeman tasolla). **Ei saa myöskään ohittaa** §2.3:n
  auth- tai XML-preflight-porttia — hint on ohje, ei bypass.

Preset-lataus tapahtuu `src/config/presets.mjs`in kautta, joka validoi
skeeman ennen käyttöä. Tuntemattomia kenttiä ei sallita (strict schema).

### 3.2 Kadence-Pro-jako (audit §4.2)

**Lukittu.** Kadence-Pro-tuki **säilytetään** (14 lisäblokkia auditti-
laskennan mukaan) mutta ilmaistaan **transformer-kohtaisena asetuksena**,
ei erillisenä preset-nimenä. Configin transformer-lista muuttuu string-
listasta objekti-listaksi:

```json
{
  "transformers": [
    { "name": "kadence", "options": { "pro": true } }
  ]
}
```

Vastaavasti muut transformerit voivat ottaa oman `options`-asetuksensa
(esim. `wpbakery`-transformer voisi vastaanottaa `{ shortcodes:
["vc_row", "vc_column", "vc_column_text"] }` -whitelistin). Rakenne on
laajennettavissa uusiin transformer-perheisiin ilman skeema-muutosta.

Nykyiset `preset: "kadence"` ja `preset: "kadence-pro"` -arvot muuttuvat
preset-tiedostoiksi `configs/presets/kadence.json` ja
`configs/presets/kadence-pro.json`, jotka eroavat vain
`transformers[0].options.pro`-arvossa.

### 3.3 Markdown vs. HTML-passthrough (audit §4.3)

**Lukittu.** Markdown default, HTML fallback yksikkötasolla. Ei "koko
sisältö HTML:nä"-oletusta eikä "kaikki pakko-Markdowniksi"-oletusta.
Ks. §2.1 ja §2.2 täsmennykset:

- `.md`-tiedoston body saa sisältää raakaa HTML:ää.
- Generic core muuntaa Markdowniksi vain turvallisesti tunnistetut rakenteet.
- Transformer-sopimus (§2.2) sitoo transformerit: jos yksikkö ei ole
  hallittavissa, alkuperäinen säilytetään.

### 3.4 YAML-korjaus root-cause (audit §4.4)

**Lukittu.** Korjauksen scope **laajenee**: kyseessä ei ole yksittäisen
`yamlValue()`-funktion refaktori, vaan **koko frontmatterin serialisointi
siirretään `js-yaml`-kirjaston kautta** (ainoa uusi runtime-riippuvuus).
Tämä koskee:

- `yamlValue()` (rivi 377) — kokonaan korvattu.
- `toFrontMatter()` (rivi 396) — kokonaan korvattu.
- Kaikki `itemToDoc()`in (rivi 4038) tuottamat frontmatter-kentät menevät
  `js-yaml.dump()`in läpi yhtenäisellä asetuksella (`{ lineWidth: -1,
  noRefs: true, quotingType: '"' }`).

**Apuskriptien siirtymä:**

- **`fix-yaml-quotes.mjs` poistetaan vasta regression jälkeen.** Se
  säilyy `scripts/`-hakemistossa niin kauan kunnes uusi `js-yaml`-
  pohjainen serialisointi on ajettu golden fixtureja vasten
  (§5) **ilman diff-eroja** vanhojen `configs/*.json`-esimerkkien läpi.
  Vasta silloin apuskripti poistetaan omalla PR:llään.
- **`validate-yaml.mjs` säilytetään testiapurina** modulointi-vaiheen
  ajan **tai korvataan** automaattisella frontmatter-parsintatestillä
  (`test/frontmatter-roundtrip.test.mjs`) joka lataa jokaisen
  tuotetun `.md`-tiedoston `js-yaml.load()`illa ja tarkistaa että
  parsinta onnistuu. Kumpi tehdään ratkaistaan testirungon (§5)
  scope-määrittelyssä.

### 3.5 Multilingual-mallin syvyys (audit §4.5)

**Lukittu.** Kolme muutosta:

**(a) Ei yhdenmukaisuus-oletusta REST-vastauksesta.** WPML ja Polylang
**eivät tarjoa `translations`-relaatiota yhdenmukaisesti** tavallisessa
`/wp/v2/{type}` -REST-vastauksessa. Tuki toteutetaan **plugin-/endpoint-
kohtaisena relation adapterina** (`src/fetch/multilingual.mjs`):

- **Capability check** ensin — mikä plugin on asennettu (`/wpml/v1/languages`,
  `/pll/v1/languages`, ei kumpaakaan) ja mitkä REST-kentät ovat
  saatavilla.
- **Adapter-toteutus per plugin** — WPML:n `translations`-avain
  `wpml_translations`-metassa, Polylangin `translations`-kenttä
  `?lang=`-vasteessa. Tuntemattoman pluginin tapauksessa adapter
  palauttaa tyhjän mapin ja migration-report merkitsee `warning`in.

**(b) Kaikki kielet yhdessä migraatioajossa, ei "jälkikäsittelyä".**
Monikieliset kohteet **haetaan ja normalisoidaan samassa migraatio-
ajossa**. **Poistetaan aikaisemman ehdotuksen "viimeisen ajon
jälkikäsittely"-linjaus** — jo kirjoitettuja tiedostoja ei muokata
erillisessä lopputyössä. Sen sijaan **write plan** rakennetaan
kokonaisuudessaan ennen ensimmäistäkään `fs.writeFile`-kutsua:

1. Fetch-vaihe: kaikki kielet, kaikki content-tyypit → in-memory
   dokumentti-taulukko `{sourceId, lang, ...}`.
2. Normalize-vaihe: relation adapter täydentää `translations`-mapin
   jokaiseen dokumenttiin, käyttäen `sourceId`-mappauksia jotka ovat
   nyt kaikki tiedossa.
3. Path resolution -vaihe: write plan päättää lopulliset polut kaikille
   kielille yhdellä kertaa.
4. Write-vaihe: kirjoitus tapahtuu vasta kun write plan on ristiriidaton.

**(c) Frontmatter-formaatti — polku + sourceId, ei pelkkä URL.**
`translations`-kenttä on nyt strukturoitu:

```yaml
lang: fi
translations:
  en:
    sourceId: 123
    path: /en/example/
  sv:
    sourceId: 456
    path: /sv/exempel/
```

`sourceId` säilyttää alkuperäisen WP-postin ID:n jotta
kohde-Eleventy-repossa voidaan tehdä liitosindeksi ilman URL-parsintaa.
`path` on migraattorin päättämä lopullinen kohde-polku.

**Fallback: `translations: unresolved`.** Jos relation adapter puuttuu
(esim. tuntematon plugin) tai capability check epäonnistuu, sisältö
**migroidaan silti** (kielikohtaiset ajot toimivat itsenäisinä), mutta
frontmatteriin kirjoitetaan **näkyvä varoitus**:

```yaml
lang: fi
translations: unresolved
```

Ja `migration-report.json`in `warnings`-listaan kirjautuu merkintä
`multilingual.relation-adapter-missing` kera plugin-nimen ja affected
`sourceId`-listan. Kohde-Eleventy-repossa käyttäjä joutuu joko
rakentamaan liitoksen manuaalisesti tai käyttämään
`sourceId`-fallbackia.

---

## 4. Modulointisuunnitelma

Karkea moduulikartta 5 287-rivisestä monoliitista noin **28 moduuliin**,
keskimäärin ~180 riviä/moduuli. Rivi-arviot perustuvat auditti-doccin §1
sijaintiin ja sisältävät §5:n P0-lisäykset (retry, coverage, YAML-rewrite).

```
src/
├── cli/
│   ├── wizard.mjs             ~300  # runWizard, readline-promptit
│   ├── run.mjs                ~100  # runFromConfig
│   └── serve.mjs              ~500  # serveUi, HTTP-server, progress-streaming
├── config/
│   ├── normalize.mjs          ~200  # createConfigFromInput
│   └── presets.mjs            ~100  # (UUSI) configs/presets/*.json -lataaja
├── fetch/
│   ├── http.mjs               ~150  # fetchJson, fetchText, fetchAllPages + retry (P0-1)
│   ├── auth.mjs               ~50   # buildAuthHeaders (Application Password default)
│   ├── content.mjs            ~250  # posts/pages/taxonomies + context=edit
│   ├── menus.mjs              ~250  # fetchMenus + 3 fallback-endpointtia
│   ├── media.mjs              ~50   # downloadFile
│   └── multilingual.mjs       ~150  # WPML/Polylang + translations-relaatio (P1-5)
├── analyze/
│   ├── site.mjs               ~400  # analyzeSite, discoverContentProfile
│   ├── theme.mjs              ~60   # detectThemeFromSignals
│   └── plugins.mjs            ~60   # detectPluginsFromSignals
├── transform/
│   ├── html.mjs               ~250  # basicHtmlToMarkdown laajennettuna (P1-2)
│   ├── media-urls.mjs         ~80   # extractMediaUrls, rewriteWpMediaUrls
│   ├── slug.mjs               ~40   # slugify (NFD + diakriitit)
│   └── yaml.mjs               ~80   # yamlValue-rewrite js-yamlilla (P0-2)
├── blocks/
│   ├── parser.mjs             ~150  # parseWpBlocks (block-comment-tokenisaattori)
│   ├── renderer.mjs           ~200  # renderBlockTree, transformer-dispatch
│   ├── kadence.mjs            ~250  # Kadence 18 + Pro 14 blokki-mappaus (feature-flag)
│   ├── wpbakery.mjs           ~300  # (UUSI) [vc_row], [vc_column], [vc_column_text], ...
│   ├── slider-revolution.mjs  ~150  # (UUSI) <rs-module> → hero-fragment
│   └── partials.mjs           ~800  # writeKadencePartials (32 template-inlineä)
├── menu/
│   ├── tree.mjs               ~120  # buildMenuTree, normalizeMenuItems
│   └── kadence-header.mjs     ~200  # parseKadenceHeaderStyles, megamenu-merge
├── styles/
│   ├── extract.mjs            ~150  # stylesheet-, variable-, import-URL:t
│   ├── inline.mjs             ~50   # extractInlineStyles
│   └── project.mjs            ~400  # configureProjectFromProfile, themeCssFromProfile
├── engine/
│   ├── item-to-doc.mjs        ~150  # itemToDoc (frontmatter + body)
│   └── migrate.mjs            ~400  # runMigration (pipeline-orkestrointi)
├── report/
│   ├── coverage.mjs           ~120  # (UUSI) coverage-metriikat (P0-3)
│   └── writer.mjs             ~120  # migration-report.json + action-items
└── main.mjs                   ~50   # CLI-entry (wizard/run/serve dispatch)
```

**Yhteensä:** ~28 moduulia, ~6 250 riviä (sisältää P0-lisäykset). Nykyisestä
+~1 000 riviä johtuu retry-logiikasta, coverage-raportista, WPBakery- ja
Slider-Revolution -transformereista, sekä `js-yaml`-refaktorin epäsymmetriasta.

**Ei-scope tässä modulointi-vaiheessa:**

- `ui/index.html` (4 537 riviä) säilyy self-contained SPA:na. Purku
  komponentteihin on erillinen työ.
- Testien lisääminen — se on P2 (audit P2-2), ei osa modulointi-vaihetta.
- Julkinen API-kontrakti moduulien välillä — jätetään koodauksen aikana
  löydettäväksi. Vain moduuli-rajat ja vastuualueet lukitaan tässä.

**Modulointi-strategia:**

1. Yksi PR per ylätason kansio (`src/fetch/`, `src/transform/`, `src/blocks/`,
   jne.). Kussakin PR:ssä siirretään funktiot monoliitista, säilytetään
   nykyinen `runMigration`-entry point kutsuvana wrapperina.
2. Ei behavior-muutoksia modulointi-vaiheessa. P0-lisäykset (retry, coverage,
   YAML-rewrite) tulevat vasta modulointi valmiina, jotta diff-luettavuus
   säilyy.
3. `scripts/wp-eleventy-migrate.mjs` säilyy ohut CLI-shim moduloinnin jälkeen
   (~50 riviä), tuoden `main.mjs`:n. Vanha `npm run migrate:wp` toimii
   muuttumattomana.

---

## 5. P0 → P1 -toteutusjärjestys

Modulointi ensin (§4). Sen jälkeen:

### Vaihe 1 — Modulointi (ei behavior-muutoksia)

Sarja ~7 PR:ää, yksi per ylätason kansio. Jokaisen PR:n jälkeen `npm run
migrate:wp -- --dry-run` toimii nykyisillä config-esimerkeillä ilman diff-
eroa outputissa.

**Ensimmäinen PR on kalibrointipiste.** Sen on sisällettävä minimaalinen
testirunko ja vähintään yksi golden fixture, jotta seuraavien 6:n PR:n
regressio voidaan mitata. Ilman vertailukohtaa modulointi voi säilyttää tai
kasvattaa piileviä regressioita ilman että kukaan huomaa. PR 1:n scope on
siis laajempi kuin vain koodinsiirto:

- **Test runner:** `node --test` (Node.js built-in, ei uusia
  runtime-riippuvuuksia). `package.json`iin `test`-script.
- **Golden fixture 1:** rajattu WP-lähteen snapshot (esim. yksi post +
  yksi page + kategoriat + tags REST-vasteet tallennettuina
  `test/fixtures/<name>/`-hakemistoon). Fixture ajetaan `runMigration`in läpi
  ja tuotettu output verrataan `test/golden/<name>/`-hakemistoon
  tavu-tavuisesti (frontmatter + body + migration-report.json diffattuina).
- **Fixture 1:n lähde:** ehdotus `jaali.eu` -alaotanta (audit-doc 02) tai
  minimalisen synteettinen WP-vasteet. Valinta tehdään PR 1:n review-vaiheessa.
- **CI-ajo:** GitHub Actions workflow joka ajaa `npm test` push-tapahtumissa.
  Tämä on P2 (audit P2-2) mutta se aikaistuu tähän PR:hän koska muuten
  golden-vertailua ei suoriteta luotettavasti.

Vasta PR 1 mergen jälkeen aloitetaan PR:t 2–7 (`src/fetch/`, `src/transform/`,
`src/blocks/`, `src/menu/`, `src/styles/`, `src/analyze/`, `src/engine/` +
`src/report/`). Kussakin PR:ssä `npm test` ajetaan ja golden-diffin on oltava
tyhjä. Jos diff ei ole tyhjä, PR sisältää behavior-muutoksen ja se palautetaan
scope-perusteella.

### Vaihe 2 — P0-korjaukset (moduloidussa koodissa)

| Aihe | Moduuli | Auditti-viite |
|---|---|---|
| Retry + exponential backoff HTTP-fetcheissä | `src/fetch/http.mjs` | P0-1 |
| YAML-rewrite `js-yaml`illa, apuskriptien poisto | `src/transform/yaml.mjs` | P0-2 |
| Coverage-metriikat migration-reportiin | `src/report/coverage.mjs` | P0-3 |

Kaikki kolme voidaan tehdä rinnakkain moduloinnin jälkeen. Jokainen PR sisältää
regressio-ajon config-esimerkkeihin.

### Vaihe 3 — P1: WPBakery + Slider Revolution -transformerit

Jaali.eu-auditin (§6.3) mukaiset edellytykset ennen kuin jaali-migraation voi
ajaa luotettavasti.

| Aihe | Moduuli | Auditti-viite |
|---|---|---|
| WPBakery-shortcode-parseri | `src/blocks/wpbakery.mjs` | jaali §6.3 (P0-tason siellä) |
| Slider Revolution → hero-fragment | `src/blocks/slider-revolution.mjs` | jaali §6.3 |
| `yoast_head_json` julkisessa fetch-moodissa | `src/fetch/content.mjs` | jaali §6.3 |
| Ulkoisen median raportointi (`externalMedia`) | `src/report/writer.mjs` | jaali §6.3 |

### Vaihe 4 — P1: Yleiset laajennukset

| Aihe | Moduuli | Auditti-viite |
|---|---|---|
| Preset-plugin-API (`configs/presets/*.json`) | `src/config/presets.mjs` | P1-1 |
| `basicHtmlToMarkdown` laajennus (taulukot, blockquotet, code-block, sisäkkäiset listat) | `src/transform/html.mjs` | P1-2 |
| Unknown-block-strategy yleistys | `src/blocks/renderer.mjs` | P1-3 |
| REST-kattavuus: authors, media metadata, ACF | `src/fetch/content.mjs` | P1-4 |
| Multilingual `translations`-relaatio | `src/fetch/multilingual.mjs` | P1-5 |
| Nunjucks-layout TODO:t | `src/blocks/partials.mjs` | P1-6 |

---

## 6. Out-of-scope

Tämä doc **ei** kata:

- `migrations/`-kansion aiempia ajoja (jo `.gitignoressa:7`).
- `_site/`-hakemistoa (Eleventy-buildin output; untracked mutta ei blokki).
- Muita jarilaru.fi-repon dokumentteja.
- Testien lisäämistä (audit P2-2).
- UI-refaktoria (`ui/index.html`).
- CI/CD-konfiguraatiota.
- Kohde-Eleventy-repon rakennusta (erillinen työ per kohdeprojekti).

---

## 7. Katselmuksen jälkeen — pienin turvallinen seuraava askel

§2 ja §3 lukittu 2026-09-14. Modulointi-vaihe 1 voidaan aloittaa.

1. **PR 1: `src/cli/`, `src/config/`, `src/main.mjs` + testirunko + golden
   fixture 1** — CLI-shim + config-normalisointi + `node --test`-runner +
   yksi golden fixture regressio-verrokiksi. Ks. §5 Vaihe 1.
2. **Ei aloiteta P0-työtä** ennen kuin kaikki 7 modulointi-PR:ää ovat merged
   ja golden-diff on tyhjä kaikilla config-esimerkeillä.
3. **CLAUDE.md päivittyy** joka modulointi-PR:n yhteydessä siltä osin kuin
   arkkitehtuuri muuttuu (rivimäärä, viittaukset, testauskäskyt).
