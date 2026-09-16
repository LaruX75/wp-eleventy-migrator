# JAALI-EU-MIGRATION-SOURCE-AUDIT-01

Status: AUDIT COMPLETE / NO IMPLEMENTATION

Kohde: `https://www.jaali.eu` (Jäälin asukasyhdistys ry)
Auditoitu: 2026-09-14
Auditti tehty jarilaru.fi-repossa; **oikea sijainti on wp-eleventy-migrator/docs/** kun repo-vaihto tehdään.
Metodi: HTTP-headereiden, homepage-HTML:n ja WP REST -endpointtien lukeminen curlilla. Ei kirjautumista, ei kirjoitusta.

## 1. Sivuston tekniikka

| Kerros | Havainto | Todiste |
|---|---|---|
| Palvelin | nginx | `server: nginx` |
| Hosting | Zoner | `x-powered-by: Zoner` |
| Sovellus | WordPress **6.9.7** | `<meta name="generator" content="WordPress 6.9.7" />` |
| Teema (parent) | **Total (WPExplorer)** | `wp-content/themes/Total/`, `wpex-*.css/js`, `vcex-shortcodes.min.css` |
| Teema (child) | **total-child-theme** | `wp-content/themes/total-child-theme/style.css` |
| Page builder | **WPBakery Page Builder v6.7.0** (ex-Visual Composer) | `<meta name="generator" content="Powered by WPBakery Page Builder..." />`, `wp-content/plugins/js_composer/` |
| Slider | **Slider Revolution 6.5.5** | `<rs-module id="rev_slider_1_1">`, `wp-content/plugins/revslider/` |
| SEO | **Yoast SEO v22.7** | `class="yoast-schema-graph"` JSON-LD, `yoast_head` REST-kentissä |
| Lomakkeet | **Contact Form 7 v5.9.5** | `wp-content/plugins/contact-form-7/` |
| Anti-spam | Akismet | REST namespace `akismet/v1` |
| Turva | Wordfence | REST namespace `wordfence/v1` |
| Social | WD Instagram Feed | `wp-content/plugins/wd-instagram-feed/` |

## 2. REST API -kattavuus

**Käytettävissä olevat namespacet:**
`wp/v2`, `oembed/1.0`, `akismet/v1`, `contact-form-7/v1`, `wordfence/v1`,
`yoast/v1`, `wp-site-health/v1`, `wp-block-editor/v1`, `wp-abilities/v1`.

**Autentikointi:** `"authentication":[]` — endpoint-tason auth ei ole listattu,
julkinen luku toimii ilman avainta. Post-listaus vastaa 200:lla myös
autentikoimattomana. Auth-vaatimus vain kirjoitukselle ja `context=edit`
-parametrille.

**Tärkeät X-WP-Total-luvut:**

| Endpoint | Kokonaismäärä |
|---|---:|
| `/wp/v2/posts` | **12** |
| `/wp/v2/pages` | **5** |
| `/wp/v2/media` | **88** |
| `/wp/v2/categories` | **26** |
| `/wp/v2/tags` | ei mitattu |
| `/wp/v2/post_series` | **0** (taksonomia olemassa, tyhjä) |

Yhteensä siis **17 julkaisua + 88 mediatiedostoa**. Erittäin pieni sivusto —
skaalausriskit (pagination, rate-limit) eivät ole reaalisia tässä lähteessä.

## 3. Taksonomiat

- `category` (26 kpl, hierarkinen, tyyppi `post`)
- `post_tag` (määrä ei mitattu, ei-hierarkinen)
- `post_series` (0 kpl, hierarkinen, plugin-tuoma — [Organize Series -tyyppinen])
- `nav_menu` (WordPress-oma)
- `wp_pattern_category` (WordPress 6.x -patterns, ei sisältörelevantti)

Ei WPML-namespace-viittausta, ei Polylang-viittausta REST-indeksissä. Sivu
deklaroituu `og:locale = en_US`:ksi mutta sisältö on suomeksi — **ei
monikielinen**, kyseessä on väärin konfiguroitu Yoast/oletus.

## 4. Sisältörakenne (näytteet)

### Etusivu (page id 2081, slug `home`)

WPBakery + Slider Revolution -kombo:

```html
[vc_row][vc_column]
    <rs-module-wrap id="rev_slider_1_1_wrapper" ...>
        <rs-module id="rev_slider_1_1" data-version="6.5.5">
            <rs-slides>
                <rs-slide ... data-bgvideo=".../Jaali promo video HD.mp4">
                    <a class="rs-layer rev-btn" href="https://youtu.be/rNpqjbHt53g">Katso video</a>
                    <rs-layer data-type="image" ...>...</rs-layer>
                </rs-slide>
            </rs-slides>
        </rs-module>
    </rs-module-wrap>
[/vc_column][/vc_row]
```

Kaksi shortcode-järjestelmää sisäkkäin: `[vc_row][vc_column]` (WPBakery) ja
`<rs-module>` (Slider Revolution HTML-elementit + `data-*`-attribuutit).

### Yksittäinen postaus (post id 2650)

Puhdas Classic Editor -tyylinen HTML:

```html
<p><strong><img class="size-full wp-image-2658 alignright" src=".../Peetupelle.jpg" />Tervetuloa!</strong>...</p>
<p>Jo perinteeksi muodostunut Jäälin venetsialaistapahtuma...</p>
<h5>Tapahtuman aikana myös:</h5>
<p><strong>Aikataulu:</strong>...</p>
```

**Ei** `<!-- wp:block -->`-markereita, ei Kadence-luokkia, ei WPBakery-
shortcodeja. Tavallista `<p>`/`<strong>`/`<img>`/`<h5>`/`<a>`-HTML:ää,
`srcset`-attribuutteja mukana.

## 5. Vertailu: WordPress-bloki-kirjot lähteessä

| Blokki-tekniikka | Onko käytössä | Sijainti |
|---|---|---|
| **Kadence Blocks** | ei | ei viitteitä |
| **Gutenberg-blokit** | ei näy näytteissä | mahdollisesti uudemmissa posteissa |
| **WPBakery / js_composer shortcodes** | kyllä (pages) | `[vc_row]`, `[vc_column]`, todennäköisesti `[vc_column_text]`, `[vc_single_image]`, `[vcex_*]` |
| **Slider Revolution** | kyllä (etusivu) | `<rs-module>`, `<rs-slide>`, `<rs-layer>` + `data-*` |
| **Total/VCEX shortcodes** | mahdollisesti | `vcex-shortcodes.min.css` ladattu — käytössä jos yhdenkin sivun body-shortcodet ovat `[vcex_*]`-alkuisia |
| **Classic Editor HTML** | kyllä (posts) | puhdas HTML `<p>`-pohjalta |

## 6. Migraattori-implikaatiot

Nykyinen `wp-eleventy-migrator` (audit 01) on **kalibroitu Kadence-lähteille**.
Tämä sivusto on **täysin eri profiili**:

### 6.1 Mikä toimii sellaisenaan

- WP REST -fetch (posts, pages, media, categories, tags) — endpointit ovat auki
  ja pagination-määrät ovat pieniä.
- `basicHtmlToMarkdown` toimii tyydyttävästi post-sisällölle (Classic Editor
  -HTML), mutta menettää `srcset`, `class`, `width`/`height` -attribuutit.
- `preset: none` on ainoa relevantti — ei Kadence-runkoa tarvita.
- YAML-frontmatterin generointi (basic-fields) toimii.

### 6.2 Mikä ei toimi

- **WPBakery-shortcodet:** ei parseria. `[vc_row][vc_column]...[/vc_column][/vc_row]`
  vuotaa Markdown-outputtiin sellaisenaan tai jää raakana HTML:nä. Etusivun
  koko content-kenttä jäisi käytännössä käyttökelvottomaksi.
- **Slider Revolution:** `<rs-module>`-hierarkia on background-video + layers +
  animaatio-data. Ei mielekästä konversiota ilman erillistä extractoria
  (esim. taustavideo → yksi `<video>`, ensimmäinen slide-kuva fallbackiksi).
- **Yoast-metan poiminta:** REST palauttaa `yoast_head` (HTML-string) ja
  `yoast_head_json` (strukturoitu), mutta nykymigrattorin `itemToDoc()`
  poimii SEO-kenttiä `meta`-objektista jonka Yoast tarjoaa vain autentikoidulle
  `context=edit`-kutsulle. **Julkinen fetch ei siis anna SEO-otsikoita**
  ilman autentikointia + `context=edit`.
- **Menut:** REST `wp/v2/menus` on käytettävissä; nykyinen `fetchMenus()`
  yrittää kolmea endpointtia (menus/v1, wp-api-menus/v2, wp/v2/menus) — vain
  viimeinen on tarjolla. Fallback-ketju toimii, mutta yhden yrityksen jälkeen.
- **Slider Revolution -kuvat mediakirjastossa:** kuvat viittaavat
  `wp-content/plugins/revslider/public/assets/assets/dummy.png` -placeholderiin
  ja todelliset kuvat ovat `data-lazyload`-attribuutissa. `extractMediaUrls`
  poimii `data-*`-lazy-URL:t (`:499`), joten tämä pitäisi toimia — **mutta ei
  ole varmennettu**.
- **Facebook/Dropbox-videot** (`www.dropbox.com/s/2ns2rka39igf4pu/...mp4`):
  ulkoinen media, ei ladata WP-mediakirjastossa. Migraattori ei tunnista näitä
  omiksi asseteiksi.

### 6.3 Mitä aidosti geneerinen migraattori tarvitsee

Priorisoituna sen mukaan, mitä juuri tämä sivusto vaatii — mutta myös yleisen
WordPress-kirjon kannalta:

1. **WPBakery-shortcode-parseri.** WPBakery on yksi kolmesta yleisimmästä
   page builder -teknologiasta WP:ssä (WPBakery, Elementor, Gutenberg-native).
   Ilman `[vc_*]`-shortcode-tukea "aidosti geneerinen" -väite ei pidä.
2. **Slider/hero-elementtien fallback-strategia.** Slider Revolution + Elementor
   Slides + Kadence Advanced Gallery + Smart Slider — kaikilla oma
   HTML-rakenne. Geneerinen ratkaisu: tunnista "slider/hero"-container,
   poimi ensimmäisen slaidin kuva + otsikko + CTA, tuota yksinkertainen
   hero-fragmentti. Ei animaatiologiikkaa.
3. **`yoast_head_json` -kentän hyödyntäminen** julkisessa fetch-tilassa.
   `?_fields=yoast_head_json` toimii ilman autentikointia ja sisältää:
   canonical, og-title/description/image, twitter-kortit, schema. Tämä
   korvaa nykyisen `meta`-riippuvuuden joka vaatii `context=edit`in.
4. **`data-lazyload` / `data-src` / `data-original` -kattavuus.**
   `extractMediaUrls` kattaa nämä (`:499`), mutta lazy-load-frameworkien
   kirjo kasvaa; regressiotesti Slider Revolution -sisältöä vasten on
   pakollinen.
5. **Ulkoisen median tunnistus.** Dropbox, YouTube, Vimeo, Facebook, S3-CDN,
   Cloudinary — nämä eivät ole WP-mediakirjastossa. Raportoi ne omaan
   sektioon (`externalMedia: [{url, type, foundIn}]`) migration-reportissa,
   älä yritä ladata. Kohde-Eleventy-repon vastuulla on päättää mitä tehdä.

### 6.4 Mitä ei tarvita tähän sivustoon

- Multilingual-logiikka (WPML/Polylang detektio, `?lang=` -parametri) — ei
  käytössä.
- Kadence-preset ja 32 blokki-partiaalia — turhat.
- Kadence-megamenun `kadence_header`/`kadence_navigation`-fetchit — turhat.
- `authMode: app-password` tai `bearer` — julkinen fetch riittää, ellei
  Yoast-metaa haluta `context=edit`-kautta.

## 7. Migraation valmistelu — mitä tehtävä ennen ajoa

### 7.1 Datan puolelta

1. **Vahvista** että sivuston omistajalla on täysi WP-admin (backup,
   uudelleenajo tarvittaessa).
2. **Ota XML-export** `wp-admin/export.php`:sta varmuuskopioksi (ei-REST-
   riippuva backup jos REST-fetch epäonnistuu).
3. **Kartoita** WPBakery-shortcode-kirjo koko sisällöstä: aja `curl`-loop
   kaikkiin 5 sivuun ja 12 postaukseen, grep `[vc_` / `[vcex_` / `[rev_`
   / `[cf7-` -alkuisia esiintymiä.
4. **Kartoita** ulkoinen media (dropbox/youtube/vimeo/facebook) sisällöstä
   samalla loopilla — merkitse migration-plan-listaan.

### 7.2 Migraattorin puolelta

Ennen kuin voi ajaa migraation tälle sivustolle **luotettavasti**, tarvitaan
vähintään:

- P0: WPBakery-shortcode-parseri (edes `vc_row/vc_column/vc_column_text/
  vc_single_image` -tuki, muut fallback-html).
- P0: `yoast_head_json`-metan poiminta julkisessa fetch-moodissa.
- P1: Slider Revolution → hero-fragmentti -mappaus (tai eksplisiittinen
  "ei tueta, säilytä HTML"-päätös raportissa).
- P1: `externalMedia`-raportointi migration-reportissa.

**Ilman P0-tason muutoksia** migraatio tuottaa käyttökelvottoman etusivun
(pelkkää `[vc_row]`-tekstiä + `<rs-module>`-massaa) ja rikkoutuneet SEO-metat.

### 7.3 Migraation kokonaisarvio

- **Skaala:** trivial (17 julkaisua, 88 mediaa) — yhden istunnon työ.
- **Kompleksisuus:** keskimääräinen — WPBakery + Slider Revolution vaativat
  parserityötä, muuten sisältö on suoraviivaista.
- **Aikataulu-arvio:** P0-työ migraattoriin (~1-2 päivää työtä), sitten
  varsinainen migraatio + kohde-Eleventy-repon rakentaminen (~1 päivä).
- **Riskit:** Slider Revolution -etusivu on suurin yksittäinen kysymysmerkki.
  Kohde-Eleventy-repossa halutaan luultavasti yksinkertainen hero-lohko
  (kuva + otsikko + CTA), ei animoituja slaideja.

## 8. Jatkosuositukset

1. **Tämä sivusto on hyvä geneerisen migraattorin testitapaus juuri siksi,
   että se ei ole Kadence-teemainen.** Jos uusi migraattori pystyy
   ajamaan jaali.eu:n läpi puhtaasti, "aidosti geneerinen"-väite alkaa
   kestää.
2. **Käytä tätä auditin scope-määrittäjänä.** WPBakery + Slider Revolution +
   Classic HTML + Yoast SEO on realistinen WP-kirjon leikkaus — kata nämä
   ensin, ennen kuin lisäät Elementor/GenerateBlocks/Spectra-tukea.
3. **Älä lisää `preset: total`-tyyppistä preset-vaihtoehtoa** — se toistaisi
   nykyisen "bespoke koodiltaan mutta geneerinen brändiltään"-virheen.
   Tuki tulee shortcode/blokki-parseri-tasolla, ei preset-tasolla.

## 9. Auditti ei kata

- Ei-julkisia REST-endpointteja (autentikointia vaativat)
- Media-tiedostojen tarkkaa kokoa ja lisenssiä
- Yksittäisten postausten kaikki sisällöt (näytteitä otettu vain 1 page + 1 post)
- Sivuston kaikkia URL-rakenteita ja mahdollisia redirectejä
- Contact Form 7 -lomakkeiden sisältöä (nämä eivät ole content vaan config)
- Wordfence/Akismet-lokeja
