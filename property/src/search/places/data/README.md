# Cambodia boundaries

`cambodia-boundaries.json` contains ADM1/2/3 polygon rings from the Cambodia
COD-AB v01 dataset, valid on 2018-10-04, published by OCHA/HDX and supplied by
the Department of Geography, Ministry of Land Management, Urbanization and
Construction, and WFP. Retrieved 2026-11-12.

Source: https://data.humdata.org/dataset/cod-ab-khm
Resource: https://data.humdata.org/dataset/7472f7e0-3deb-44d9-bd36-38237c666a2e/resource/2926d754-10b7-4742-889c-eb37aedd1d03/download/khm_admin_boundaries.geojson.zip
License: Creative Commons Attribution 3.0 IGO
https://creativecommons.org/licenses/by/3.0/igo/

Adaptation: retain each `admN_name`, its level, and its GeoJSON geometry;
normalize Polygon to MultiPolygon; round coordinates to six decimal places.
No rings or vertices were simplified or removed. Source layers contain
25 provinces, 197 districts and 1,633 communes.

This is a published map snapshot, not a guarantee of current legal boundaries.
Name and location must both match; recently split communes and unmapped places
keep their usual nearby listings without an invented outline. Live Google Places
verification on 2026-11-12 matched Kampot city and Kampot province. The top
Chom Chau suggestion is Chom Chao 1, which is absent from this snapshot;
it intentionally receives no outline, rather than the old combined Chaom Chau shape. Update the whole
snapshot from a newer licensed release to support changed administrative areas.
