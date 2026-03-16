<div align="center">
  <img src="assets/extension-icon.png" alt="Globalping Icon" width="70" height="70">
  <h1>The Official Globalping Extension for Raycast</h1>
  <p><em>Run ping, traceroute, MTR, DNS, and HTTP checks from Globalping probes directly in Raycast.</em></p>
</div>

---

## Features

- Run network measurements from multiple probes worldwide
- Compare probe results in a compact Raycast-native UI
- Choose locations from continents, countries, cities, cloud regions, networks, ASNs, and more
- Re-run DNS queries with different record types and HTTP checks with different methods using keyboard shortcuts
- Keep your most-used probe locations handy with recent and popular local suggestions
- Share or copy results for debugging and support workflows

## Commands

This extension includes five commands:

- `Ping`: Compare latency, packet loss, and per-probe timing data
- `DNS`: Resolve `A`, `AAAA`, `TXT`, `MX`, `NS`, and `CNAME` records from multiple locations
- `HTTP`: Run `HEAD`, `GET`, `POST`, `PUT`, `DELETE`, and `OPTIONS` requests from distributed probes
- `Traceroute`: Inspect the route to a target hop by hop
- `MTR`: Combine latency and route data in a compact multi-hop view

## Configuration

Globalping works without authentication, but you can unlock higher limits by adding an API token in the extension preferences.

Available preferences:

- `API Token`: Optional token from [dash.globalping.io](https://dash.globalping.io)
- `Default Probe Count`: Global default number of probes used by all commands

Without a token, Globalping still works, but the public API has lower rate and probe limits.

## Usage

1. Open one of the Globalping commands in Raycast
2. Enter a hostname, domain, or URL target
3. Optionally pick a probe location from the `From` dropdown
4. Run the test with `⌘R`

Tips:

- If you leave the location empty, the extension falls back to your most-used local location when available, otherwise `world`
- DNS record types can be switched from the action panel with shortcuts
- HTTP methods can be switched from the action panel with shortcuts
- Results stream into the list as probe updates arrive

## Supported Locations

The location picker is built from Globalping probe data and supports more than just cities and countries. Depending on probe availability, you can target:

- `world`
- Continents and regions
- Countries and US states
- Cities
- Providers and ASNs
- Network types like `eyeball` and `datacenter`
- Cloud filters such as `aws+europe`, `aws-us-east-1`, `gcp-europe-west3`, or `azure-eastus`

## Notes

- Probe availability depends on the live Globalping network
- Some measurement types may complete in batches depending on the API response model
- This extension uses the official Globalping API at `api.globalping.io`

## Development

This extension was created by [@Valent1d](https://github.com/valent1d) for Globalping