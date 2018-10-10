## Go

These settings apply only when `--go` is specified on the command line.

``` yaml $(go)
  license-header: MICROSOFT_APACHE_NO_VERSION
  namespace: insights
  clear-output-folder: true
```

### Go multi-api

``` yaml $(go) && $(multiapi)
batch:
  - tag: v1
```

### Tag: v1 and go

These settings apply only when `--tag=v1 --go` is specified on the command line.
Please also specify `--go-sdk-folder=<path to the root directory of your azure-sdk-for-go clone>`.

``` yaml $(tag) == 'v1' && $(go)
output-folder: $(go-sdk-folder)/services/appinsights/v1/insights
```

``` yaml $(typescript)
typescript:
  package-name: azure-applicationinsights-query
  package-version: 1.0.0-Preview-1
  output-folder: $(node-sdks-folder)/lib/services/applicationinsightsQuery/lib
  generate-metadata: true
  azure-arm: true
  add-credentials: true
directive:
  - from: swagger-document
    where: $.definitions.table.properties.rows.items.items
    transform: $.type = "object"
```