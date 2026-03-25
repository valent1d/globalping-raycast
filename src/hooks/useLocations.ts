import { useRef } from "react";
import { useCachedPromise } from "@raycast/utils";
import { getProbes, type Probe } from "../api/globalping";
import { getLocationStats } from "../utils/storage";

export interface LocationItem {
  title: string;
  value: string;
}

export interface LocationSection {
  title: string;
  items: LocationItem[];
}

// Location Mappings

const CONTINENT_NAMES: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

// Magic values accepted by the Globalping API for each continent
const CONTINENT_MAGIC: Record<string, string> = {
  AF: "africa",
  AN: "antarctica",
  AS: "asia",
  EU: "europe",
  NA: "north america",
  OC: "oceania",
  SA: "south america",
};

const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina",
  AU: "Australia",
  AT: "Austria",
  BE: "Belgium",
  BR: "Brazil",
  BG: "Bulgaria",
  CA: "Canada",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  HR: "Croatia",
  CZ: "Czechia",
  DK: "Denmark",
  EG: "Egypt",
  FI: "Finland",
  FR: "France",
  DE: "Germany",
  GH: "Ghana",
  GR: "Greece",
  HK: "Hong Kong",
  HU: "Hungary",
  IN: "India",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IT: "Italy",
  JP: "Japan",
  KE: "Kenya",
  KR: "South Korea",
  LT: "Lithuania",
  MY: "Malaysia",
  MX: "Mexico",
  NL: "Netherlands",
  NZ: "New Zealand",
  NG: "Nigeria",
  NO: "Norway",
  PK: "Pakistan",
  PL: "Poland",
  PT: "Portugal",
  RO: "Romania",
  RU: "Russia",
  SA: "Saudi Arabia",
  SG: "Singapore",
  ZA: "South Africa",
  ES: "Spain",
  SE: "Sweden",
  CH: "Switzerland",
  TW: "Taiwan",
  TH: "Thailand",
  TR: "Turkey",
  UA: "Ukraine",
  AE: "UAE",
  GB: "United Kingdom",
  US: "United States",
  VN: "Vietnam",
};

const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const CLOUD_PROVIDERS = [
  { key: "aws", title: "AWS", magic: "aws" },
  { key: "gcp", title: "Google Cloud", magic: "google" },
  { key: "azure", title: "Azure", magic: "azure" },
] as const;

/**
 * Removes invisible/control characters from location values used in storage and UI.
 */
function sanitizeLocationText(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;

      return !(
        codePoint <= 0x1f ||
        codePoint === 0x7f ||
        codePoint === 0x200b ||
        codePoint === 0x200c ||
        codePoint === 0x200d ||
        codePoint === 0x2060
      );
    })
    .join("")
    .trim();
}

/**
 * Sorts dropdown items alphabetically by their display title.
 */
function sortByTitle(items: LocationItem[]): LocationItem[] {
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Converts provider region tags into readable dropdown labels.
 */
function titleFromCloudTag(tag: string): string {
  if (tag.startsWith("aws-")) return `AWS · ${tag.slice(4)}`;
  if (tag.startsWith("gcp-")) return `GCP · ${tag.slice(4)}`;
  if (tag.startsWith("azure-")) return `Azure · ${tag.slice(6)}`;
  return tag;
}

/**
 * Builds the combined recent/popular section and returns the preferred default location.
 */
function buildRecentPopularSection(
  baseSections: LocationSection[],
  recentLocations: string[],
  popularLocations: string[],
): { sections: LocationSection[]; preferredLocation?: string } {
  const titleByValue = new Map<string, string>();

  for (const section of baseSections) {
    for (const item of section.items) {
      const normalizedValue = sanitizeLocationText(item.value).toLowerCase();
      if (normalizedValue && !titleByValue.has(normalizedValue)) {
        titleByValue.set(normalizedValue, sanitizeLocationText(item.title) || item.title);
      }
    }
  }

  const mergedValues: string[] = [];
  const seenValues = new Set<string>();

  for (const rawValue of [...recentLocations, ...popularLocations]) {
    const value = sanitizeLocationText(rawValue);
    const normalizedValue = value.toLowerCase();

    if (!normalizedValue || seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    mergedValues.push(value);
  }

  const items = mergedValues.slice(0, 5).map((value) => ({
    title: titleByValue.get(value.toLowerCase()) ?? value,
    value,
  }));

  return {
    sections:
      items.length > 0
        ? [
            {
              title: "Recent / Popular",
              items,
            },
          ]
        : [],
    preferredLocation: items[0]?.value,
  };
}

/**
 * Removes empty or duplicate items from all location sections before rendering.
 */
function sanitizeSections(sections: LocationSection[]): LocationSection[] {
  return sections
    .map((section) => {
      const seenValues = new Set<string>();
      const items = section.items
        .map((item) => {
          const title = sanitizeLocationText(item.title);
          const value = sanitizeLocationText(item.value);

          return { title, value };
        })
        .filter((item) => {
          const { title, value } = item;
          const normalizedValue = value.toLowerCase();

          if (!title || !value || !normalizedValue || seenValues.has(normalizedValue)) {
            return false;
          }

          seenValues.add(normalizedValue);
          return true;
        });

      return { ...section, items };
    })
    .filter((section) => section.items.length > 0);
}

// Builder

/**
 * Builds all location dropdown sections from the live Globalping probe catalogue.
 */
function buildSections(probes: Probe[]): LocationSection[] {
  const continents = new Set<string>();
  const regions = new Set<string>();
  const countries = new Set<string>();
  const usStates = new Set<string>();
  const cities = new Set<string>();
  const networks = new Set<string>();
  const asns = new Set<number>();
  const cloudRegions = new Set<string>();
  const cloudProviders = new Set<string>();
  const cloudContinents = new Set<string>();
  const networkTypes = new Set<string>();

  for (const probe of probes) {
    const { continent, region, country, city, state, network, asn } = probe.location;
    if (continent && CONTINENT_MAGIC[continent]) continents.add(continent);
    if (region) regions.add(region);
    if (country) countries.add(country);
    if (country === "US" && state) usStates.add(state);
    if (city) cities.add(city);
    if (network) networks.add(network);
    if (asn) asns.add(asn);

    for (const tag of probe.tags ?? []) {
      if (tag === "eyeball-network") networkTypes.add("eyeball");
      if (tag === "datacenter-network") networkTypes.add("datacenter");

      if (tag.startsWith("aws-")) {
        cloudRegions.add(tag);
        cloudProviders.add("aws");
        if (continent && CONTINENT_MAGIC[continent]) cloudContinents.add(`aws|${continent}`);
      }

      if (tag.startsWith("gcp-")) {
        cloudRegions.add(tag);
        cloudProviders.add("gcp");
        if (continent && CONTINENT_MAGIC[continent]) cloudContinents.add(`gcp|${continent}`);
      }

      if (tag.startsWith("azure-")) {
        cloudRegions.add(tag);
        cloudProviders.add("azure");
        if (continent && CONTINENT_MAGIC[continent]) cloudContinents.add(`azure|${continent}`);
      }
    }
  }

  return [
    {
      title: "Global",
      items: [{ title: "World", value: "world" }],
    },
    {
      title: "Cloud Providers",
      items: sortByTitle(
        CLOUD_PROVIDERS.filter((provider) => cloudProviders.has(provider.key)).map((provider) => ({
          title: provider.title,
          value: provider.magic,
        })),
      ),
    },
    {
      title: "Cloud + Continents",
      items: sortByTitle(
        [...cloudContinents].map((entry) => {
          const [providerKey, continentCode] = entry.split("|");
          const provider = CLOUD_PROVIDERS.find((item) => item.key === providerKey);
          const continentName = CONTINENT_NAMES[continentCode] ?? continentCode;

          return {
            title: `${provider?.title ?? providerKey} + ${continentName}`,
            value: `${provider?.magic ?? providerKey}+${CONTINENT_MAGIC[continentCode] ?? continentName.toLowerCase()}`,
          };
        }),
      ),
    },
    {
      title: "Cloud Regions",
      items: sortByTitle(
        [...cloudRegions].map((tag) => ({
          title: titleFromCloudTag(tag),
          value: tag,
        })),
      ),
    },
    {
      title: "Continents",
      items: sortByTitle(
        [...continents].map((code) => ({ title: CONTINENT_NAMES[code] ?? code, value: CONTINENT_MAGIC[code] })),
      ),
    },
    {
      title: "Regions",
      items: sortByTitle(
        [...regions].map((region) => ({
          title: region,
          value: region,
        })),
      ),
    },
    {
      title: "Countries",
      items: sortByTitle([...countries].map((code) => ({ title: COUNTRY_NAMES[code] ?? code, value: code }))),
    },
    {
      title: "US States",
      items: sortByTitle(
        [...usStates].map((state) => ({
          title: US_STATE_NAMES[state] ?? state,
          value: US_STATE_NAMES[state] ?? state,
        })),
      ),
    },
    {
      title: "Cities",
      items: sortByTitle(
        [...cities].map((city) => ({
          title: city,
          value: city,
        })),
      ),
    },
    {
      title: "Providers",
      items: sortByTitle(
        [...networks].map((network) => ({
          title: network,
          value: network,
        })),
      ),
    },
    {
      title: "Network Types",
      items: sortByTitle(
        [...networkTypes].map((type) => ({
          title: type === "eyeball" ? "Eyeball" : "Datacenter",
          value: type,
        })),
      ),
    },
    {
      title: "ASNs",
      items: sortByTitle(
        [...asns].map((asn) => ({
          title: `AS${asn}`,
          value: `AS${asn}`,
        })),
      ),
    },
  ].filter((s) => s.items.length > 0);
}

// Fallback

const FALLBACK_SECTIONS: LocationSection[] = [
  {
    title: "Global",
    items: [{ title: "World", value: "world" }],
  },
  {
    title: "Cloud Providers",
    items: [
      { title: "AWS", value: "aws" },
      { title: "Azure", value: "azure" },
      { title: "Google Cloud", value: "google" },
    ],
  },
  {
    title: "Cloud + Continents",
    items: [
      { title: "AWS + Europe", value: "aws+europe" },
      { title: "AWS + North America", value: "aws+north america" },
      { title: "Google Cloud + Europe", value: "google+europe" },
      { title: "Google Cloud + North America", value: "google+north america" },
      { title: "Azure + Europe", value: "azure+europe" },
      { title: "Azure + North America", value: "azure+north america" },
    ],
  },
  {
    title: "Cloud Regions",
    items: [
      { title: "AWS · eu-west-3", value: "aws-eu-west-3" },
      { title: "AWS · us-east-1", value: "aws-us-east-1" },
      { title: "GCP · europe-west3", value: "gcp-europe-west3" },
      { title: "GCP · us-east1", value: "gcp-us-east1" },
      { title: "Azure · eastus", value: "azure-eastus" },
      { title: "Azure · westeurope", value: "azure-westeurope" },
    ],
  },
  {
    title: "Continents",
    items: [
      { title: "Africa", value: "africa" },
      { title: "Asia", value: "asia" },
      { title: "Europe", value: "europe" },
      { title: "North America", value: "north america" },
      { title: "Oceania", value: "oceania" },
      { title: "South America", value: "south america" },
    ],
  },
  {
    title: "Regions",
    items: [
      { title: "Western Europe", value: "Western Europe" },
      { title: "Northern America", value: "Northern America" },
      { title: "Eastern Asia", value: "Eastern Asia" },
    ],
  },
  {
    title: "Countries",
    items: [
      { title: "Australia", value: "AU" },
      { title: "Brazil", value: "BR" },
      { title: "Canada", value: "CA" },
      { title: "France", value: "FR" },
      { title: "Germany", value: "DE" },
      { title: "India", value: "IN" },
      { title: "Japan", value: "JP" },
      { title: "Netherlands", value: "NL" },
      { title: "Poland", value: "PL" },
      { title: "Singapore", value: "SG" },
      { title: "United Kingdom", value: "GB" },
      { title: "United States", value: "US" },
    ],
  },
  {
    title: "US States",
    items: [
      { title: "California", value: "California" },
      { title: "New York", value: "New York" },
      { title: "Texas", value: "Texas" },
    ],
  },
  {
    title: "Cities",
    items: [
      { title: "Amsterdam", value: "Amsterdam" },
      { title: "Frankfurt", value: "Frankfurt" },
      { title: "London", value: "London" },
      { title: "New York", value: "New York" },
      { title: "Paris", value: "Paris" },
      { title: "Singapore", value: "Singapore" },
      { title: "Sydney", value: "Sydney" },
      { title: "Tokyo", value: "Tokyo" },
    ],
  },
  {
    title: "Providers",
    items: [
      { title: "Amazon", value: "amazon" },
      { title: "Comcast", value: "comcast" },
      { title: "Google", value: "google" },
      { title: "OVH", value: "ovh" },
    ],
  },
  {
    title: "Network Types",
    items: [
      { title: "Datacenter", value: "datacenter" },
      { title: "Eyeball", value: "eyeball" },
    ],
  },
  {
    title: "ASNs",
    items: [
      { title: "AS13335", value: "AS13335" },
      { title: "AS15169", value: "AS15169" },
      { title: "AS16509", value: "AS16509" },
    ],
  },
];

// Hook

/**
 * Loads location sections from Globalping, falling back to a static catalogue when needed.
 */
export function useLocations() {
  const abortable = useRef<AbortController>(null);
  const { data, isLoading } = useCachedPromise(
    async () => {
      const locationStats = await getLocationStats();
      const recentLocations = [...locationStats]
        .sort((a, b) => b.lastUsed - a.lastUsed || b.count - a.count)
        .map((stat) => stat.location);
      const popularLocations = [...locationStats]
        .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
        .map((stat) => stat.location);

      try {
        const probes = await getProbes(abortable.current?.signal);
        const baseSections = buildSections(probes);
        const recentPopular = buildRecentPopularSection(baseSections, recentLocations, popularLocations);

        return {
          locationSections: sanitizeSections([...recentPopular.sections, ...baseSections]),
          preferredLocation: recentPopular.preferredLocation,
        };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        const recentPopular = buildRecentPopularSection(FALLBACK_SECTIONS, recentLocations, popularLocations);
        return {
          locationSections: sanitizeSections([...recentPopular.sections, ...FALLBACK_SECTIONS]),
          preferredLocation: recentPopular.preferredLocation,
        };
      }
    },
    [],
    {
      keepPreviousData: true,
      initialData: { locationSections: FALLBACK_SECTIONS, preferredLocation: undefined },
      abortable,
    },
  );

  return {
    locationSections: data?.locationSections ?? FALLBACK_SECTIONS,
    preferredLocation: data?.preferredLocation,
    isLoading,
  };
}
