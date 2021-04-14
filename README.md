# BCP02-Fungible-Token-Boilerplate

This boilerplate will show you a way to issue and transfer a BCP02-Fungible-Token.

## How to Build

```

npm install

```

## How to Run

- mongo
- a private key of bitcoin for you
- run a <a href="https://github.com/sensible-contract/BCP02-Fungible-Token-Composer">BCP02-Fungible-Token-Composer</a> node
- node version > 12.0.0

Generate a private key

```
node tools/generateWif.js
```

Here is a example for config

```
replace the "xxxxxxx" in ft.json with the generated wif above
(you may send some BSV to the address)
src/config/ft.json
{
  "default": {
    "feeWallets": [
      {
        "addressBy": "",
        "wif": "xxxxxxxx",
        "unitSatoshis": 100000
      }
    ],
    "apiTarget": "metasv",
    "network": "mainnet",
    "feeb": 0.5,
    "tokenApiPrefix": "http://127.0.0.1:8093"
  },
  ...
}



```

and then just run

```

node src/app.js

```

or run in production

```

node src/app.js env=production

```

## <span id="apimethod">Api Method</span>

- [genesis](#genesis)
- [issue](#issue)
- [transfer](#transfer)

### <span id="genesis">genesis</span>

- params

| param       | required | type         | note     |
| ----------- | -------- | ------------ | -------- |
| genesisWif  | true     | string       |          |
| tokenName   | true     | string       | 20 bytes |
| tokenSymbol | true     | string       | 10 bytes |
| decimalNum  | true     | unsigned int | 1 bytes  |

- req

```shell
curl -X POST  -H "Content-Type: application/json" --data '{
    "genesisWif":"xxxxxxxxxxxxxxxxxxx",
    "tokenName":"OVTS",
    "tokenSymbol":"OVTS",
    "decimalNum":3
}' http://127.0.0.1:8094/api/ft/genesis
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "genesisId": "8594ed2dfdac4d6664116ccb85ba2d8e1c805a193453ace39155eeeeb66e70fb"
  }
}
```

### <span id="issue">issue</span>

- params

| param               | required | type           | note                       |
| ------------------- | -------- | -------------- | -------------------------- |
| genesisId           | true     | string         | come from the genesis step |
| tokenAmount         | true     | unsigned int64 | token amount               |
| receiverAddress     | true     | string         | receiver address           |
| allowIncreaseIssues | true     | bool           | allow to issue again       |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "genesisWif":"xxxxxxxxxxxxxxx",
    "genesisId":"8594ed2dfdac4d6664116ccb85ba2d8e1c805a193453ace39155eeeeb66e70fb",
    "tokenAmount":"1000000000000",
    "receiverAddress":"1GQwTKcQDcAaTwRN8wWLKGZCuxugDQ49dj",
    "allowIncreaseIssues":false
}' http://127.0.0.1:8094/api/ft/issue
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "txId": "580015e8a9de2d5b82065700295f17bd9f6e86b2f26e3135901b9fb76a3f5d0e"
  }
}
```

### <span id="transfer">transfer</span>

- params

| param     | required | type   | note                               |
| --------- | -------- | ------ | ---------------------------------- |
| genesisId | true     | string | come from the genesis step         |
| senderWif | true     | string | sender wif                         |
| receivers | true     | array  | [{amount:"xxx",address:'xxx'},...] |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "genesisId":"8594ed2dfdac4d6664116ccb85ba2d8e1c805a193453ace39155eeeeb66e70fb",
    "senderWif":"xxxxxxxxxxxxxx",
    "receivers":[{
    	"address":"1GQwTKcQDcAaTwRN8wWLKGZCuxugDQ49dj",
    	"amount":"10000"
    }]
}' http://127.0.0.1:8094/api/ft/transfer

```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "txId": "a8f2e576a0df79170486f7bdc7d88d2106e075ce91a6083c8643a7197b1a2a61"
  }
}
```
