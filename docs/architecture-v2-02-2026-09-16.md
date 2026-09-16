# WP-ELEVENTY-MIGRATOR-ARCHITECTURE-V2-02 — shortcode-aware preflight

Status: **PROPOSAL / AWAITING REVIEW** — kahdeksan täsmennyspäätöstä
(§1–§8) ovat ehdotustilassa katselmuksen odottavana. §9:n
toteutusjärjestys ja §11:n seuraavan implementointi-PR:n scope +
testivaatimukset ovat **sovittu ehdotettu implementaatiosuunnitelma**,
eivät toteutettuja ominaisuuksia. Ensimmäisen implementointi-PR:n
scope pysyy tarkasti rajattuna (§11): shortcode-parseri,
analyze/write-planin criticality-raportointi ja transformer-plan-lohko.
Se ei toteuta WPBakery-transformeria, media-/attachment-resoluutioita
eikä `--accept-broken-content`-ohitusta.

Perusta: `docs/architecture-v2-01-2026-09-14.md` (LOCKED 2026-09-14).
Tämä versio **tarkentaa** v2-01:tä; ei muuta locked-päätöksiä §2.1–§2.3
tai §3.1–§3.5:tä muuten kuin täsmentää sopimuksia jotka jäivät liian
löyhiksi ensimmäisen preflight-toteutuksen (PR #3) valmistuttua ja
ensimmäisen ei-Kadence-lähteen offline-shortcode-auditin
(jaali.eu-WXR, 2026-09-16) läpi käytyä.

Vaikutus lopputoteutukseen: **estävä** ennen ensimmäistä transformer-
implementointi-PR:ää (WPBakery). Neljä kohtaa (§1, §2, §3, §5) muuttavat
transformer-API:n muotoa siten että väärä toteutusjärjestys tekisi
korjaamisen jälkikäteen kalliiksi.

## 0. Ongelmalauseke

Ensimmäinen analyze-only preflight (PR #3, `src/app/analyze.mjs`)
tunnistaa lohkoja `parseWpBlocks`in kautta — Gutenberg-`<!-- wp:name -->`-
comment-syntaksia. Offline-audit jaali.eu:n WXR-exportista (2026-09-16,
17 published-dokumenttia) osoittaa että sama preflight kirjaa
lähdesivustolle joka on **täysin shortcode-riippuvainen**:

- 90 shortcode-esiintymää 11 dokumentissa
- 9 eri `vc_*`-shortcodea kattaa 79/90 esiintymistä
- 6 dokumenttia on shortcode-vapaita Classic Editor -HTML:ää
- yhden dokumentin sisältö on käytännössä yksi shortcode (`rev_slider` etusivulla)

seuraavat lukemat: **0 Gutenberg-lohkoa, 0 Kadence-lohkoa, 0 varoitusta.**
Preflight nykyversiossaan antaa väärän turvallisuustunteen: sivut näyttävät
"puhtailta" mutta ovat käyttökelvottomia ilman transformer-tason
käännöstä ja mahdollisia kohde-Eleventy-korvauksia.

Auditti todistaa **kahdeksan** kohtaa joissa v2-01:n sopimus on liian
löyhä tai puuttuu. Nämä lukitaan tässä doccissa. Auditti on evidenssi;
arkkitehtuuri ei ole jaali-kohtainen.

---

## 1. Päätös — Shortcode-tunnistus preflightin pakollisena osana

**Ehdotus.** Gutenberg-lohkojen parseri ei riitä preflight-tunnistukseen.
Preflight tunnistaa ja jäsentää sisäkkäiset WordPress-shortcodet
**puumaiseksi rakenteeksi**. Regex-litistys (globaali find-and-replace,
ei tunnista sisäkkäisyyttä) ei ole sallittu tunnistus­kerroksena.

**Moduulikartan (v2-01 §4) lisäys.**

```
src/blocks/shortcode-parser.mjs   ~150 riviä  — yleinen [name attr="v"] …
                                                 [/name] -tokenisointi
                                                 sisäkkäisyyttä tukevaan
                                                 AST:iin. Ei WPBakery-,
                                                 Total-, Kadence- eikä
                                                 sivustokohtaista logiikkaa.
```

Rinnalla `src/blocks/parser.mjs` (Gutenberg-comment-tokenisaattori, jo
v2-01:ssä). Molemmat ovat lähde-agnostisia primitiivejä; analyze- ja
migrate-orkestraattorit valitsevat kutsujärjestyksen.

**Shortcode-parserin virhe- ja escape-sopimus (lukittu).**

- **Rakennetuki:** parseri tukee paired-shortcodeja
  (`[name attr="v"]…[/name]`), self-closing-shortcodeja (`[name /]`
  tai `[name attr="v"]` ilman sulkevaa tagia joka on eksplisiittisesti
  merkitty self-closingiksi), sekä sisäkkäisiä puumaisia rakenteita
  (`[outer][inner]…[/inner][/outer]`).
- **Lähdesäilytys:** parseri säilyttää **alkuperäisen lähdetekstin**
  ja **source-span:in** (`{ start, end }` merkki-indeksit) jokaiselle
  tunnistetulle yksikölle. Tämä mahdollistaa `preservedSourceUnits`-
  raportoinnin (§4) ilman että lähdetekstiä joudutaan rekonstruoimaan.
- **Ei arvauskorjausta:** parseri **ei tulkitse eikä korjaa** virheellistä,
  sulkematonta tai escapettua shortcode-syntaksia arvaamalla. Näihin
  kuuluvat mm.:
  - `[name attr="v"` — sulkeva `]` puuttuu
  - `[name]…` — sulkeva `[/name]` puuttuu
  - `\[name\]` tai `[[name]]` — escape-käytäntöjä joita WordPress
    kohtelee kirjaimellisena tekstinä
- **Käsittelemättömän lähdeyksikön luokittelu:** tällaiset tapaukset
  merkitään käsittelemättömiksi lähdeyksiköiksi ja saavat vähintään
  `criticality: "manual-review"`-varoituksen (§3). Yksikkö
  luokitellaan `unit`-nimeltään `malformed-shortcode` tai
  `escaped-shortcode` sen mukaan mikä pattern tunnistettiin.
- **Ei litistys:** parseri **ei koskaan hävitä eikä litistä** virheellistä
  lähdesisältöä; se säilyy alkuperäisenä tekstinä ja `sourceItem`in
  raakasisältö säilyy jäljitettävänä sha256-ekvivalentin kautta jos
  jäljitys on tarpeen (implementaatiodetalji).

Tämä sopimus kytkeytyy §3:n unhandled-invarianttiin ja on parserin
osalta täydellinen: parseri ei anna transformer-kerroksen "tunnistaa"
epäkelpoa syntaksia, koska parserin AST on jo merkinnyt sen
käsittelemättömäksi.

**Preflight raportoi (analyze/write plan):**

- shortcode-perheet ja niiden esiintymämäärät
- dokumenttikohtaiset esiintymät (`documents[].shortcodes: [{name, count}]`)
- tunnistamattomat yksiköt (transformer-lista ei kata)
- shortcode-yksiköitä ei enää piilotetaan `blocks: []`-tyhjyyden alle

**Ei-triviaali seuraus:** preflight ei saa enää kirjata sivua
turvallisesti migroitavaksi, jos siinä on shortcodet joita mikään
`config.transformers`-listassa oleva transformer ei käsittele. Tämä
kytkeytyy §3:n `criticality`-luokitteluun ja §7:n write-portin
blocking-tarkastukseen.

**Perustelu.** V2-01 §2.2 sanoo että "block-by-block" tarkoittaa mitä
tahansa tunnistettua lähdesisältöyksikköä — mukaan lukien shortcodet.
Nykyinen `parseWpBlocks` on Gutenberg-only. Yleinen shortcode-parseri
täyttää v2-01:n locked-lupauksen; ilman sitä lupaus on kirjaimellinen
mutta ei toimeenpantu.

**Ei-implikaatioita.** Shortcode-parseri **ei** sisällä renderöintiä.
Se on tokenisaattori. WPBakery-, Total-, Slider-Revolution-, tai muu
transformer kuluttaa parserin AST:in omalla predikaatillaan ja
render-funktiollaan.

---

## 2. Päätös — Transformer-konteksti (API-muoto)

**Ehdotus.** V2-01 §2.2 kuvaa transformerin `render`-funktiota mutta ei
lukitse sen argumentteja. Lukitaan tässä.

Transformer saa **konteksti-objektin**, ei pelkkää content-stringiä:

```js
transformer.render({
  unit,                  // tunnistettu AST-solmu (block tai shortcode)
  sourceItem,            // koko lähde-item (post/page) — id, slug, link, meta
  config,                // normalisoitu migraatio-config
  resolveMediaById,      // (id: number) => { url, alt, sizes, mime } | null
  resolveInternalLink    // (href: string) => { targetPath, sourceId } | null
})
```

**Invariantit.**

- Transformer **ei tee omaa REST-fetchia** eikä muutakaan verkko- tai
  tiedostojärjestelmätila-muutosta. Kaikki ulkoiset lookup:it kulkevat
  kontekstin `resolve*`-funktioiden kautta.
- **Engine rakentaa resolverit ja indeksit ennen transformerien
  kutsumista.** Käytännössä: `_embed=1`-vastauksen `_embedded.wp:featuredmedia`
  ja koko item-lista jäsennetään lookup-mapiksi ennen kuin ensimmäistä
  transformer-render-kutsua tehdään. Sama linkeille (item-URL → target-
  path -indeksi).
- **Resolverit ovat testattavia riippuvuuksia:** transformer-yksikkötesti
  antaa mock-resolver:it eikä vaadi verkkoa, tiedostoja tai enginee.
- **Ei arvauslogiikkaa transformerin sisällä.** Jos `resolveMediaById(123)`
  palauttaa `null`, transformer **ei arvaa** URL:ia (esim. rakentamalla
  `${wpBaseUrl}/wp-content/uploads/…`). Alkuperäinen yksikkö säilytetään
  sellaisenaan + `actionItems.unhandledUnits[]`-warning
  (`reason: "media-id-unresolved"`, `criticality: "manual-review"`).
  Sama linkeille (`resolveInternalLink → null`).

**Perustelu.** WPBakery-audit paljasti `vc_single_image image="123"`
-tyyppiset attribuutit joissa on WP-attachment-ID, ei URL. Sama koskee
tulevia sisäisiä linkkejä `<a href="/asukasyhdistys/">`, joiden
kohde-permalink on tunnettava. Ilman kontekstiobjektia jokainen
transformer joutuisi joko duplikoida engine-logiikkaa tai kutsua
engine-symboleita suoraan — kumpikin rikkoo v2-01 §2.2:n
transformer-eristyksen.

**Ei-implikaatioita.** Kontekstiobjekti ei ole nyt "runtime plugin
system". Se on **funktiokutsujen API-muoto**. Uusia arkkitehtuurikerroksia
ei synny; engine-orkestraattori kokoaa kontekstin ja välittää sen
transformer-listan render-funktioille sen mukaan mikä predikaatti osui.

---

## 3. Päätös — Unhandled-yksiköiden luokittelu

**Ehdotus.** V2-01 §2.2:n locked-invariantti pysyy voimassa:
käsittelemätöntä sisältöä **ei hävitetä** eikä muunneta osittain.
Alkuperäinen lähdeyksikkö säilytetään ja `actionItems.unhandledUnits[]`
saa merkinnän.

Merkinnän muoto lukitaan:

```json
{
  "transformer": "wpbakery",          // valinnainen; null jos yksikään ei osunut
  "unit": "rev_slider",               // shortcode/block-nimi
  "count": 1,
  "sourceId": 2081,
  "sourceUrl": "https://www.example.com/",
  "criticality": "blocking",          // uusi kenttä — pakollinen
  "reason": "Runtime widget; target-side replacement required."
}
```

**Kriitikaalisuustasot (kolme):**

- **`informational`** — sivun semantiikka säilyy. Kohde tarvitsee
  mahdollisesti tyylityötä (esim. WPBakery-`vc_empty_space` säilytettynä
  raakana HTML:nä toimii ilman transformer-käsittelyä; layout näyttää
  identtiseltä pieninipin CSS-työn jälkeen). Ei estä write-vaihetta,
  ei vaadi ihmispäätöstä ennen migraatiota.
- **`manual-review`** — sisältö säilyy lähdeyksikkönä (esim. `[vc_*]`-
  shortcode `.md`-bodyssä) mutta ei renderöidy sellaisenaan ilman
  ihmisen tai myöhemmän transformerin päätöstä. Esimerkkejä: tuntematon
  shortcode-perhe, `resolveMediaById` palautti `null`, sisäinen linkki
  jonka kohde puuttuu write plan:ista. Ei estä write-vaihetta oletuksena,
  mutta write plan merkitsee dokumentin `overallStatus: "manual-review"`.
- **`blocking`** — sivun olennainen toiminto tai sisältö ei toteudu
  ilman kohde-Eleventy-korvausta. Esimerkkejä: Slider Revolution
  (etusivun ainoa sisältö), dynaaminen blogilistaus (`vcex_blog_grid`,
  `[latest-posts]`), lomake (Contact Form 7, Gravity Forms). Käynnistää
  §7:n write-portin.

**"Decorative"-luokka** saa olla transformerin **sisäinen** merkintä
(esim. `vc_empty_space`in oma tunniste), mutta se **ei ole lupa pudottaa
käsittelemätöntä sisältöä**. Jos transformer luokittelee yksikön
"decorative"-tason ja **ei renderöi mitään**, alkuperäinen lähdeyksikkö
silti säilytetään ja `actionItems.unhandledUnits[]` saa
`criticality: "informational"`-merkinnän.

**Perustelu.** Nykyinen v2-01 §2.2 sanoo "warning + preserved-content"
yhdellä tasolla. Kaikki warningit näyttävät samalta migration-reportissa,
vaikka niiden vaikutus lopputulokseen on radikaalisti eri. Kolmiportainen
`criticality` tekee näkyväksi mitkä unhandled-yksiköt vaativat toimintaa
ennen kohde-sivuston julkaisua ja mitkä ovat kosmeettisia.

---

## 4. Päätös — Write plan -näkyvyys transformer-käsittelyyn

**Ehdotus.** V2-01 §3.4 (koko frontmatter-serialisointi js-yamlilla) ja
§5:n P0-3 (coverage-metriikat migration-reportiin) tähtäävät
migration-reportin laatuun. Sama laajennus tehdään **write plan** -
sopimukselle.

`write-plan.json` -sopimusta laajennetaan dokumenttikohtaisella
`transformerPlan`-lohkolla:

```json
"documents": [
  {
    "sourceId": 2081,
    "sourceUrl": "https://www.example.com/",
    "type": "pages",
    "slug": "home",
    "targetPath": "content/pages/home.md",
    "targetPermalink": "/",
    "transformerPlan": {
      "handledUnits": [
        { "transformer": "wpbakery", "unit": "vc_row",          "count": 2 },
        { "transformer": "wpbakery", "unit": "vc_column",       "count": 4 },
        { "transformer": "wpbakery", "unit": "vc_column_text",  "count": 1 }
      ],
      "unhandledUnits": [
        { "unit": "rev_slider",     "count": 1, "criticality": "blocking" },
        { "unit": "vc_empty_space", "count": 2, "criticality": "informational" }
      ],
      "preservedSourceUnits": [
        { "unit": "html-fragment",  "count": 3, "bytes": 452 }
      ],
      "overallStatus": "blocked"
    }
  }
]
```

**`overallStatus`-arvot:**

- **`complete`** — kaikki tunnistetut yksiköt käsitelty transformerilla
  tai turvallisesti säilytetty (ei `manual-review`- eikä `blocking`-
  warningeja).
- **`partial`** — dokumentti sisältää `informational`-warningeja tai
  raakana säilytettyjä HTML-fragmentteja jotka ovat kelvollisia
  `.md`-bodyssä.
- **`manual-review`** — vähintään yksi `manual-review`-warning; sivu
  vaatii kohde-Eleventy-työtä mutta ei estä write-vaihetta.
- **`blocked`** — vähintään yksi `blocking`-warning; §7:n write-portti
  laukeaa oletuksena.

**Selkeä ei-tässä-PR:ssä-merkintä.** Tämän kohdan `transformerPlan`-
laajennus **ei ole vielä toteutettu**. Se on **seuraavan
implementointi-PR:n hyväksymiskriteeri** (ks. §11) yhdessä
shortcode-parserin ja criticality-luokittelun kanssa.

---

## 5. Päätös — Transformerien järjestys ja luokat

**Ehdotus.** V2-01 §2.2 sanoo "Käynnistetään config-flägillä
`transformers: [...]`" mutta ei lukitse mitä tapahtuu jos useampi
transformer voisi käsitellä saman yksikön. Lukitaan:

- **Transformerit arvioidaan `config.transformers`-listan järjestyksessä.**
- **Ensimmäinen jonka `handles(unit) === true` voittaa** ja saa `render`-
  kutsun.
- Jos yksikään transformer ei palauta `handles(unit) === true`, sovelletaan
  v2-01:n fallback-invarianttia: alkuperäinen yksikkö säilytetään ja
  `actionItems.unhandledUnits[]` saa merkinnän §3:n mukaisesti.
  `criticality`-arvon transformerin puuttuessa määrittelee **enginen
  fallback-taulukko** (`shortcode → criticality`-oletukset) johon
  transformerit voivat lisätä itsensä; tuntematon shortcode saa
  oletuksena `manual-review`.

**Moduulikartan luokittelu.**

V2-01 §4 asettaa transformerit yhteen `src/blocks/`-kansioon
(`kadence.mjs`, `wpbakery.mjs`, `slider-revolution.mjs`). Erotellaan
selkeästi:

```
src/blocks/
├── shortcode-parser.mjs        (§1, lähde-agnostinen tokenisaattori)
├── parser.mjs                  (Gutenberg-comment tokenisaattori, v2-01)
├── renderer.mjs                (dispatch-orkestraattori)
├── page-builders/              — rakenteelliset rakentajat
│   ├── kadence.mjs
│   ├── wpbakery.mjs
│   ├── elementor.mjs            (tulossa)
│   └── (generateblocks.mjs, spectra.mjs — tulevat)
├── plugins/                    — yksittäisten pluginien runtime- ja
│   │                             dynaamisten shortcodejen korvaukset
│   ├── slider-revolution.mjs
│   ├── contact-form-7.mjs
│   ├── pdf-embedder.mjs
│   ├── total-vcex.mjs           (Total-teeman runtime-/dynaamiset
│   │                             shortcodet — ei rakenteellinen builder)
│   └── (wpforms.mjs, gravity-forms.mjs — tulevat)
└── partials.mjs                (writeKadencePartials, v2-01)
```

**Ero page-builder- ja plugin-luokan välillä:**

- **Page-builder-transformer** tunnistaa **rakenteellisen hierarkian**
  (`vc_row → vc_column → vc_column_text`, `kadence/rowlayout →
  kadence/column → kadence/advancedheading`) ja tuottaa layout-Nunjucks-
  outputia. Käyttää shortcode-parserin **tai** Gutenberg-parserin AST:ia.
- **Plugin-transformer** korvaa **yhden** shortcoden yhdellä
  kohde-implementaatiolla ilman rakenteellista parsintaa. Näiden output
  on lähes aina `criticality: "blocking"` tai `"manual-review"` koska
  ne edellyttävät joko kohdesivuston oman toteutuksen (Netlify Forms,
  Alpine.js -slider, PDF-viewer, custom-loop-partial dynaamiselle
  listaukselle) tai iframe/embed-korvauksen.

**Total-teeman VCEX** on **erillinen `total-vcex`-transformer plugin-
luokassa**, ei WPBakeryn sisäinen oletus eikä page-builder-luokassa.
Vaikka `vcex_*`-shortcodet syntyvät samasta WPBakery-plugin-perheestä
(`js_composer`), niiden semantiikka on **runtime- ja dynaaminen**:
`vcex_blog_grid` renderöi dynaamisen postauslistan (kysyy runtime-datan),
`vcex_button` on yksittäinen CTA-widget, `vcex_feature_box` on
runtime-renderöity kuva-teksti-yhdistelmä. Ne eivät ole rakenteellisia
grid-elementtejä kuten `vc_row`/`vc_column`. Sijoittaminen plugin-
luokkaan on siksi semantiikan mukaista: yksittäisen shortcoden korvaus
kohde-implementaatiolla tai `criticality: "blocking"`-warning kohti
kohde-Eleventy-työtä.

**Perustelu.** Kadence-transformer on ainoa nykyinen; WPBakery-tulokas
tekee ambigiteetin näkyväksi ensimmäistä kertaa. Priorisointisääntö
pitää olla käytännössä eksplisiittinen ennen kuin useampi transformer
lähetetään tuotantoon.

---

## 6. Päätös — Presettien nimeäminen (§3.1:n täsmennys)

**Ehdotus.** V2-01 §3.1:n locked-teksti kieltää "bespoke-nimet"
preset-tasolla mutta ei erottele kohdesivuston nimeä theme- tai
plugin-perheen nimestä. Tarkennus:

- **Kohdesivuston nimi ei ole koskaan transformerin eikä presetin nimi**
  (`jaali`, `generation-ai-stn`, `example-com`).
- **Theme- ja plugin-perheiden nimet ovat sallittuja transformerien
  tunnisteina**, esimerkiksi `wpbakery`, `total-vcex`, `kadence`,
  `kadence-pro`, `elementor`, `slider-revolution`, `contact-form-7`.
- **Preset on edelleen versionoitu ja skeemavalidoitu yleinen
  kokoonpano**, joka kokoaa transformereita ja niiden asetuksia.
- **Tuoteperheen nimi ei automaattisesti tee erillisestä presetistä
  tarpeellista.** Esimerkiksi yleinen preset voi sisältää useita
  transformereita saman ajon aikana:
  ```json
  {
    "$schemaVersion": "1",
    "transformers": [
      { "name": "wpbakery",   "options": {} },
      { "name": "total-vcex", "options": {} }
    ],
    "styles": { "migrateStyles": true, "stylesDir": "styles/legacy" },
    "auth-hint": { "preferredAuthMode": "app-password", "xmlBackupRecommended": true }
  }
  ```
  Preset **ei** ole per-transformer-nimi vaan yleinen kokoonpano, joka
  voi vetää mielivaltaisen setin transformereita yhteen ajokerrossa.
- **Preset ei sisällä salaisuuksia, kohdesivuston nimeä eikä
  preflight-porttien ohituksia** (v2-01 §2.3:n XML-preflight tai v2-02
  §7:n content-gate).

**Perustelu.** V2-01:n kielto oli reaktio "bespoke-per-site-preset"-
haittaa vastaan. Transformer-nimet ja preset-nimet ovat kaksi eri
nimeämistasoa: transformer-nimi tunnistaa uudelleenkäytettävän
theme/plugin-perheen (`wpbakery`), preset-nimi tunnistaa
uudelleenkäytettävän **kokoonpanon** (`generic-classic-editor`,
`wp-with-forms`) joka kokoaa transformerit + tyylit + auth-hint:it
yhdeksi käyttötapaus-profiiliksi. Kumpikaan ei viittaa kohdesivuston
omaan nimeen.

---

## 7. Päätös — Blocking-portti write-vaiheeseen

**Ehdotus.** Uusi turvallisuusgate rinnalla v2-01 §2.3:n XML/WXR-portin.

- **Jos analyze/write plan sisältää `blocking`-tason käsittelemättömiä
  yksiköitä (§3), write-vaihe estyy oletuksena.**
- Ohitus vaatii nimenomaisen vaarallisen CLI-valinnan
  `--accept-broken-content`. UI:ssa vastaava ohitus vaatii **kirjoitetun
  vahvistuksen** (esim. käyttäjän on kirjoitettava `ACCEPT-BROKEN-CONTENT`
  tekstikenttään).
- Ohitus **ei kirjoitetaan config-tiedostoon**; se on ajokohtainen
  CLI-argumentti (samoin kuin `--skip-xml-backup` §2.3:ssa).
- Ohitus ja kaikki blocking-yksiköt kirjataan näkyvästi
  `migration-report.json`iin:
  ```json
  "contentGate": {
    "status": "bypassed",
    "acceptedAt": "2026-09-16T14:00:00.000Z",
    "blockingUnits": [
      { "sourceId": 2081, "unit": "rev_slider", "count": 1, "reason": "…" }
    ]
  }
  ```
- Verified-tapauksessa (ei blocking-yksiköitä):
  ```json
  "contentGate": { "status": "clean", "verifiedAt": "…" }
  ```

**Erillisyys XML/WXR-portista.** Tämä ei korvaa v2-01 §2.3:n
XML-backup-porttia — se on eri riskiluokka (backup-varmuus). Blocking-
portti on **sisältöturvaportti**: onko migraation output
julkaisukelpoinen ilman ihmisen manuaalityötä.

Kaksi porttia yhdessä muodostavat kaksivaiheisen preflight-safety-
tason: ennen fetch:iä (XML backup) + ennen write:iä (content-gate).

---

## 8. Päätös — CSS ja kohdeprojektin autonomia (Vaihtoehto B)

**Ehdotus.** Ensimmäiselle WPBakery-transformerille lukitaan **vaihtoehto B**:

- **Transformer tuottaa semanttista HTML:ää ja rajatut, nimetyt luokat**
  (esim. `<section class="row"><div class="col col-1-2">…`). Luokat
  dokumentoidaan transformerin JSDoc:issa.
- **Transformer ei automaattisesti kirjoita kohdeprojektin CSS-, layout-
  eikä Eleventy-konfiguraatiotiedostoja.** Sama invariantti kuin
  v2-01 §2.1:ssä (Nunjucks-syntaksin osalta) laajennetaan CSS:iin.
- Transformer lisää tarvittavat CSS-vaatimukset
  `migration-report.json`in `targetSetupNotes`-lohkoon:
  ```json
  "targetSetupNotes": [
    {
      "source": "wpbakery-transformer",
      "requirement": "CSS classes .row, .col, .col-1-2, .col-1-3, .col-2-3, .col-1-4, .col-3-4 must be provided by the target theme.",
      "affectedDocuments": 10
    }
  ]
  ```
- **Erillinen opt-in `TARGET-SETUP.md`** (v2-01 §2.1:n mukainen) voidaan
  myöhemmin tuottaa, mutta se ei ole oletus. `emitTargetSetupNotes: true`
  -flägi käynnistää sen. `TARGET-SETUP.md` on ohjeohjelma, ei
  konfiguraatiotiedosto — sama sopimus kuin v2-01 §2.1:ssä.

**Miksi ei vaihtoehto A (transformer generoi CSS-tiedoston).**
Kohde-Eleventy-projekti voi olla design-system-pohjainen (Tailwind,
CSS-in-JS, custom-tokens), jolloin transformerin generoima CSS-tiedosto
olisi joko ristiriitainen tai päällekkäinen kohteen kanssa. Vaihtoehto B
tekee migraattorista **väitteitä-vapaan** kohteen tyylistrategiasta.

---

## 9. Toteutusjärjestys

**Ehdotettu implementaatiosuunnitelma — ei toteutettu tässä doc-PR:ssä
eikä lukittu ennen katselmusta.** Alla oleva järjestys määrittää
tulevien implementointi-PR:ien rajauksen ja sekvenssin. Kohdat 2–4
vaativat kukin oman PR:nsä; niiden koodia, transformereita,
media-indeksiä eikä write-portin CLI-ohitusta ei tuoteta tässä
doc-only-PR:ssä eikä myöskään §11:n rajaamassa ensimmäisessä
implementointi-PR:ssä.

Ehdotettu järjestys §1–§8:n hyväksynnän jälkeen:

1. **Shortcode-parser + analyze/write-planin shortcode- ja
   criticality-raportointi.**
   - `src/blocks/shortcode-parser.mjs`
   - `src/app/analyze.mjs`in laajennus: kutsu molempia parsereita,
     kirjaa `documents[].shortcodes` ja `documents[].transformerPlan`
   - `criticality`-luokittelu `actionItems.unhandledUnits[]`iin
   - Testit: uusi golden fixture non-Kadence-shortcode-lähteestä

2. **WPBakery-page-builder-transformer ilman attachment-ID-kuvia.**
   - `src/blocks/page-builders/wpbakery.mjs`
   - Tuki (7 shortcodea) ja niiden esiintymämäärät jaali.eu-audit-
     evidenssistä (2026-09-16, 17 published-dokumenttia):
     - `vc_row`: 20 esiintymää
     - `vc_column`: 27 esiintymää
     - `vc_row_inner`: 1 esiintymä
     - `vc_column_inner`: 1 esiintymä
     - `vc_column_text`: 9 esiintymää
     - `vc_empty_space`: 9 esiintymää
     - `vc_custom_heading`: 4 esiintymää

     **Yhteensä 71 esiintymää 90:stä eli noin 79 % kaikista
     shortcodeista ja noin 90 % `vc_*`-esiintymistä.** Numerot ovat
     yhden auditti-lähteen evidenssi, eivät hyväksymiskriteeri;
     transformer-toteutus voi jäädä alle 100 %:iin `vc_*`-perheestä
     ensimmäisessä iteraatiossa.
   - Fallbackiin: `vc_single_image`, `vc_video`, `vcex_*` (`total-vcex`-
     transformer tulee erikseen vaiheessa 4), sekä kaikki muut `vc_*`-
     shortcodet joita audit ei jaali.eu-lähteestä havainnut mutta jotka
     voivat esiintyä muissa WPBakery-sivustoissa.
   - Transformer-kontekstin `resolveMediaById` kutsutaan, mutta 1.
     iteraatiossa se palauttaa aina `null` (media-indeksi tulee vaiheessa 3);
     `vc_single_image` säilyy siksi `manual-review`-tasolla.
   - `targetSetupNotes`-CSS-luokat (§8): `.row`, `.col`, `.col-1-2`,
     `.col-1-3`, `.col-2-3`, `.col-1-4`, `.col-3-4`, `.v-space`.

3. **Media-/attachment-indeksi ja `vc_single_image`.**
   - `resolveMediaById`-toteutus enginen `_embed=1`-vastauksesta ja
     `wp/v2/media`-endpointista
   - `vc_single_image`in nostaminen `handled`-listalle
   - Media-koveraatti write plan:iin

4. **Slider Revolution, Contact Form 7, PDF Embedder, Total-VCEX
   -korvaukset** erillisinä P1-työitä ja päätöksinä:
   - Kukin oma implementointi-PR:nsä
   - `src/blocks/plugins/{slider-revolution,contact-form-7,pdf-embedder,total-vcex}.mjs`
   - Todennäköisesti kaikki tuottavat `criticality: "blocking"`-warningit
     ensimmäisessä iteraatiossaan, ei render-outputia — se on hyväksyttävä
     lähtökohta ja käyttäjä valitsee `--accept-broken-content`in tarvittaessa

Vaiheet 1 ja 2 ovat pakolliset ennen kuin ei-Kadence-sivustoja voi
migroida ilman `--accept-broken-content`-ohitusta. Vaihe 3 nostaa
kattavuutta. Vaihe 4 on kohdesivustokohtainen riippuen mitä pluginit
lähteessä on käytössä.

---

## 10. Suhde v2-01-doccciin

**V2-01:n locked-päätökset pysyvät voimassa:**

- §2.1 Markdown + frontmatter default
- §2.2 Kaksivaiheinen HTML-käsittely + generic-core + opt-in transformerit
- §2.2 Transformer-sopimus (unhandled = säilytä + varoita)
- §2.3 Application Password + XML-preflight
- §3.1–§3.5 (preset-plugin-API, Kadence-Pro-options, Markdown vs HTML,
  js-yaml, translations-adapter)

**V2-02 tarkentaa nämä kohdat:**

- §2.2 → V2-02 §1 (shortcode-parser + preflight-vaatimus)
- §2.2 (transformer-render-signatura) → V2-02 §2 (konteksti-objekti)
- §2.2 (unhandled-warning) → V2-02 §3 (criticality-luokat)
- §2.3 → V2-02 §7 (rinnakkainen content-gate)
- §3.1 → V2-02 §6 (theme/plugin-nimet OK preset-tasolla)
- §4 modulointi-kartta → V2-02 §1 ja §5 (shortcode-parser, page-builders/,
  plugins/, total-vcex-erottelu)
- §5 P0-3 → V2-02 §4 (write plan `transformerPlan`)

**V2-02 ei muuta:**

- Yhtään locked-tekstiä v2-01:ssä. Kaikki § numerot ja lauseet pysyvät
  paikallaan.
- Engine-, cli-, config- eikä analyze-koodia. Tämä on doc-only-PR.
- Muita dokumentteja (auditit `-01-*.md`, `USAGE.md`).

**Katselmuksen jälkeen:** kun v2-02 lukitaan, alkuperäinen v2-01-doc
säilyy koskemattomana. Uudet implementointi-PR:t viittaavat molempiin
(v2-01 base, v2-02 tarkennukset).

---

## 11. Seuraavan implementointi-PR:n tarkka scope

**Ehdotettu rajaus — ei toteutettu tässä doc-PR:ssä eikä lukittu ennen
katselmusta.** Alla oleva scope on ensimmäisen implementointi-PR:n
sovittu hyväksymiskriteeri sen jälkeen kun §1–§8 katselmoidaan ja
lukitaan. Ensimmäinen implementointi-PR kirjoitetaan omaksi haarakseen
myöhemmin; tässä doc-PR:ssä sen sisältöä ei aloiteta.

**Implementointi-PR (ehdotettu haaranimi):
`feat/shortcode-parser-and-preflight-criticality`**

Tavoite: v2-02 §1 + §3 + §4 (osittain) toteutus. **Ei transformer-
implementaatiota, ei media-/attachment-resoluutiota eikä
`--accept-broken-content`-ohitusta tässä PR:ssä.**

Muutokset:

- Uusi `src/blocks/shortcode-parser.mjs` — yleinen `[name attr]…[/name]`-
  tokenisaattori sisäkkäisyyttä tukevaan AST:iin. ~150 riviä.
- `src/app/analyze.mjs` laajennus:
  - Kutsu myös `shortcodeParser.parse(content)` lohko-parserin rinnalla
  - `documents[].shortcodes: [{name, count}]` lisäys write plan:iin
  - `documents[].transformerPlan` -lohko (§4) — vain `handledUnits: []`,
    `unhandledUnits: [{unit, count, criticality}]`, `preservedSourceUnits`,
    `overallStatus`
  - `criticality`-luokittelu enginen fallback-taulukosta (§3): tuntematon
    shortcode → `manual-review` oletus; enginen `KNOWN_BLOCKING`-lista
    (`rev_slider`, `contact-form-7`, `wpforms`, `gravity-form`,
    `vcex_blog_grid`, `latest-posts`, jne.) → `blocking`; enginen
    `KNOWN_INFORMATIONAL`-lista (`vc_empty_space`, `nbsp`) →
    `informational`
- Uusi testi-fixture: `test/fixtures/analyze-preflight-shortcodes/`
  jossa on WXR-tyylinen post-sisältö WPBakery + rev_slider + vcex_-
  shortcodeja
- Testien laajennus `test/analyze-preflight.test.mjs`:iin. Vähintään
  seuraavat tapaukset (yhteensä ≥ 7 uutta testiä):
  1. **Sisäkkäinen paired-shortcode** — `[outer][inner]…[/inner][/outer]`
     tunnistetaan puumaiseksi, ei litistetty rinnakkaisiksi.
  2. **Self-closing shortcode** — `[name attr="v" /]` ja implisiittisesti
     self-closing (esim. `[vc_empty_space height="16px"]` ilman
     sulkevaa tagia enginessa) tunnistetaan itsenäiseksi lehdeksi.
  3. **Escapettu shortcode** — `\[name\]` tai `[[name]]` ei käsitellä
     aktiivisena yksikkönä; säilyy lähdetekstinä. `manual-review`-
     warning `unit: "escaped-shortcode"`.
  4. **Sulkematon / virheellinen shortcode** — `[name attr="v"`
     (sulkeva `]` puuttuu) tai `[name]…` ilman `[/name]`iä säilyy
     lähdetekstinä. `manual-review`-warning
     `unit: "malformed-shortcode"`. Lähdesisältö ei litisty eikä
     hävita.
  5. **`blocking`-luokittelu nousee raporttiin** — mock-fixture sisältää
     `rev_slider`in ja `vcex_blog_grid`in; write plan sisältää
     `criticality: "blocking"`-merkinnät.
  6. **`overallStatus` heijastaa criticality-jakaumaa** — dokumentti
     jolla vain `informational`-warningeja saa `overallStatus:
     "partial"`; dokumentti jolla `blocking`-warning saa `"blocked"`.
  7. **Source-span säilyttäminen** — parserin AST sisältää jokaiselle
     tunnistetulle yksikölle `{ start, end }`-indeksit joita voi
     käyttää alkuperäisen tekstin poimimiseen.

**Ei tässä PR:ssä:**

- Ei WPBakery-transformeria (§9 vaihe 2)
- Ei `resolveMediaById`-toteutusta (§9 vaihe 3)
- Ei write-portin CLI-flägia `--accept-broken-content` (§7 tulee sen
  PR:n mukana joka lisää migrate-vaiheeseen; analyze on read-only eikä
  laukaisu tarvitse porttia)
- Ei arch-doccin lukitusta LOCKED-tilaan — tämä on doc-only-PR joka
  jää PROPOSED-tilaan katselmusta odottaen

**Hyväksymiskriteerit:**

- `npm test` 34/34 + uudet testit
- Analyze-ajo jaali.eu-WXR:ää vasten tuottaa `write-plan.json`:in jossa
  `plan.blocks.gutenberg = []` mutta `documents[].shortcodes[]` on
  kirjattu ja `documents[].transformerPlan.overallStatus` on
  `"manual-review"` tai `"blocked"` kaikille shortcode-riippuvaisille
  dokumenteille
- Engine-symboleiden semantiikka koskematta; ainoa engine-diff on
  export-listan mahdollinen laajennus jos shortcode-parser tarvitsee
  jotain (todennäköisesti ei — se on lähde-agnostinen ja voi elää
  itsenäisenä src/blocks/-moduulina)
- Ei muutoksia CLI:in, configin, migrate-pipelineen, UI:in tai muihin
  dokumentteihin

---

## 12. Out-of-scope

- V2-01:n locked-tekstin muuttaminen
- Engine-, CLI-, config- tai UI-koodi
- Uudet käyttäjänäkyvät komennot (analyze-komento on jo olemassa)
- WPBakery-, Slider-Revolution-, CF7-, PDF-Embedder- tai muu
  transformer-implementaatio
- Media-/attachment-indeksin toteutus
- Testien lisääminen (paitsi §11:n PR:n hyväksymiskriteereissä)
- CI/CD-workflow-tiedostojen luonti

Handoff palautuu ChatGPT:lle §1–§8:n katselmusta varten.
