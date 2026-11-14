# AstroVital

## Personalized Astronaut Health Intelligence System

AstroVital is a research-oriented prototype for exploring biological, environmental, sleep, activity, and wellbeing data relevant to astronaut health.

## 1. Inspiration4 Astronaut Data

Includes:

- Serum metabolic and immune markers
- Complete Blood Count (CBC)
- Plasma metabolomics (ANP and RP-MTBE)

Main integrated dataset:

`data/processed/Inspiration4/Inspiration4_integrated_serum_CBC_metabolomics.csv`

Separate serum and CBC dataset:

`data/processed/Inspiration4/OSD-575_OSD-569_serum_CBC_aligned.csv`

The integrated dataset contains 4 astronauts and 24 observations.

**Original data source:**

- [NASA Open Science Data Repository (OSDR)](https://osdr.nasa.gov/)
- Relevant studies: OSD-569, OSD-570, OSD-571, and OSD-575.

## 2. External Human Reference Data

**Source: MMASH (Multilevel Monitoring of Activity and Sleep in Healthy People)**

Includes:

- Sleep summaries
- Activity summaries
- Psychological scores
- RR-derived HRV measurements

MMASH participants are not astronauts. Their records remain separate from Inspiration4 data.

**Original data source:**

- [MMASH Dataset – PhysioNet](https://physionet.org/content/mmash/1.0.0/)
- [MMASH Dataset Documentation and Original Publication](https://doi.org/10.3390/data5040091)

## 3. Space Environment Data

Includes NASA environmental and radiation measurements such as:

- Radiation
- CO2
- Temperature
- Humidity

These measurements are maintained separately from astronaut biological data.

**Original data sources:**

- [NASA Environmental Data App](https://visualization.osdr.nasa.gov/eda/)
- [NASA Open Science Data Repository](https://osdr.nasa.gov/)

## 4. Supporting Biological Research

Additional NASA studies include research on:

- Muscle cells
- Endothelial cells
- Blood lymphocytes
- Smooth muscle cells
- Neuronal cell models
- Brain organoids (files pending)

These are supporting research datasets, not direct astronaut measurements.

**Original data source:**

- [NASA Open Science Data Repository](https://osdr.nasa.gov/)
- [NASA OSDR – About and Data Resources](https://science.nasa.gov/biological-physical/data/osdr/)

## Repository Structure

- `data/raw/`: Original downloaded data (excluded from GitHub)
- `data/processed/`: Processed and integrated datasets
- `metadata/`: Study metadata and sample information
- `reports/`: Collection and quality-control reports

## Data Processing Principles

- Original raw datasets are preserved unchanged.
- Missing values are not automatically imputed.
- Different biological materials remain distinguishable.
- Datasets are aligned only when identifiers and metadata support it.
- External human reference data remains separate from astronaut data.

## Limitations

- Inspiration4 contains a small number of astronauts.
- Some datasets have missing measurements and different timepoints.
- MMASH is not a spaceflight dataset.
- Cell-based research is not direct astronaut health data.
- HRV metrics are exploratory and not clinically validated.
- AstroVital is a research prototype, not a medical diagnostic system.

## Data Sources

| Source | Description | Official Link |
|---|---|---|
| NASA OSDR | Spaceflight and space-relevant biological datasets | [OSDR](https://osdr.nasa.gov/) |
| NASA Environmental Data App | ISS environmental telemetry and radiation data | [Environmental Data App](https://visualization.osdr.nasa.gov/eda/) |
| PhysioNet MMASH | External human sleep, activity, and physiological reference data | [MMASH](https://physionet.org/content/mmash/1.0.0/) |
| MMASH Publication | Original dataset research paper | [DOI](https://doi.org/10.3390/data5040091) |

Consult original dataset documentation, publications, and licensing terms before reuse.

## Project Status

Data collection, selected processing, and main Inspiration4 integration have been completed. The project is being prepared for GitHub.

Additional datasets and research components may remain pending.
