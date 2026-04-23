# ポケBOXtracker (PokéBOXTracker)

A fully automated web dashboard for tracking the Japanese Pokémon Card boxes market changes. 


## ✨ Features
- **Dual-Market Tracking**: Gets market values from **SNKRDUNK**.
- **Global Benchmarking**: Integrates with PokemonPriceTracker to compare USD trends.
- **Dynamic Metadata**: Powered by the **TCGdex API**, automatically fetching official high-res Japanese PNG/WebP scans, proper translations, and native set numbers directly into your dashboard.
- **Native Localization**: Effortlessly toggle the entire UI between English and Japanese with a single click.
- **Zero-Cost Automation**: Runs entirely through GitHub Actions (Serverless) and GitHub Pages (Static Hosting) with no database costs. 

---

## 🚀 How It Works
1. A GitHub Actions workflow (`.github/workflows/update-prices.yml`) wakes up every 3 hours.
2. It reads `src/config.json` to find your tracked cards.
3. It hits the **TCGdex API** to get the pristine visual metadata for those cards.
4. It scrapes the current market prices from the targeted URLs.
5. It merges all of this data safely into `data/prices.json`, then automatically commits and pushes the updated file to the repository.
6. The GitHub Pages dashboard instantly reflects the latest prices on live charts without any database queries.
