# Cargo Ledger

A client-side Star Citizen cargo trade profit tracker.

**Live site:** https://garulf.github.io/cargo-ledger/

- Game data (terminals, commodities, prices) comes from the [UEX Corp API](https://uexcorp.space), cached in your browser (24h for terminals/commodities, 1h for prices) and refreshable with the ↻ button.
- All of your data (run history, in-progress run, settings) stays in your browser via localStorage — nothing is sent anywhere.
- Prices are prefills you can overtype — enter the actual numbers you paid and received.

## Development

No build step. Serve the folder statically:

```
python3 -m http.server
```

Then open http://localhost:8000
