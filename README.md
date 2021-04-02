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

Here is a example for config

```

src/config/ft.json
{
  "default": {
    "wif": "cN2gor4vF2eQ1PmzTzJEwps6uvTK4QToUgTxGHN1xUxZ34djL8vR",
    "apiTarget": "whatsonchain",
    "network": "testnet",
    "feeb": 0.5,
    "tokenApiPrefix": "http://127.0.0.1:8091"
  },
  "production": {
    "wif": "",
    "apiTarget": "metasv",
    "network": "mainnet",
    "feeb": 0.5,
    "tokenApiPrefix": "http://127.0.0.1:8091"
  }
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
| tokenName   | true     | string       | 20 bytes |
| tokenSymbol | true     | string       | 10 bytes |
| decimalNum  | true     | unsigned int | 1 bytes  |

- req

```shell
curl -X POST  -H "Content-Type: application/json" --data '{
    "tokenName":"ENJIN",
    "tokenSymbol":"ENJ",
    "decimal":2
}' http://127.0.0.1:8092/api/ft/genesis
```

- rsp

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "genesisId": "1ee411ab7e23a1f60513a332dd6f593acf1118d2354795c501188dcc0f72a492"
  }
}
```

### <span id="issue">issue</span>

- params

| param               | required | type           | note                 |
| ------------------- | -------- | -------------- | -------------------- |
| genesisId           | true     | string         | genesisId            |
| tokenAmount         | true     | unsigned int64 | token amount         |
| receiverAddress     | true     | string         | receiver address     |
| allowIncreaseIssues | true     | bool           | allow to issue again |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "genesisId":"1ee411ab7e23a1f60513a332dd6f593acf1118d2354795c501188dcc0f72a492",
    "tokenAmount":"100",
    "receiverAddress":"1MzEyAMS3eM63gMcc9AVjZSEu4j3KYpBVQ",
    "        allowIncreaseIssues":true
}' http://127.0.0.1:8092/api/ft/issue
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
| genesisId | true     | string | genesisId                          |
| senderWif | true     | string | sender wif                         |
| receivers | true     | array  | [{amount:"xxx",address:'xxx'},...] |

- req

```shell
curl -X POST -H "Content-Type: application/json" --data '{
    "genesisId":"1ee411ab7e23a1f60513a332dd6f593acf1118d2354795c501188dcc0f72a492",
    "senderWif":"L2YWukZEh9b7wLMLRrZWnaEZCHaTMXnQAH75ZuvhrTvAeFa6vxMM",
    "receivers":[{
    	"address":"1MzEyAMS3eM63gMcc9AVjZSEu4j3KYpBVQ",
    	"amount":"1"
    },{
    	"address":"1MzEyAMS3eM63gMcc9AVjZSEu4j3KYpBVQ",
    	"amount":"2"
    }]
}' http://127.0.0.1:8092/api/ft/transfer
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
