# MMASH External Human Reference Data

## Source
MMASH is an external human reference dataset.
It is not astronaut data and does not represent spaceflight measurements.

## Included processed datasets
- Sleep summary
- Activity summary with HR quality review
- Psychological questionnaire scores
- Conservative RR-derived HRV windows
- All RR-derived HRV windows with quality flags
- Participant-level RR/HRV quality summary

## HRV limitations
- HRV metrics are exploratory and are not clinically validated.
- RR intervals were screened using provisional quality rules.
- Windows requiring review are excluded from the conservative HRV file.
- Original RR files remain unchanged in data/raw/MMASH.
- Participant user_4 has a substantial number of review-flagged windows.

## Integration limitation
MMASH participants must remain separate from Inspiration4 astronauts.
Do not join participants across these datasets.

## Missing data
Original missing values are preserved. No blanket imputation was applied.
