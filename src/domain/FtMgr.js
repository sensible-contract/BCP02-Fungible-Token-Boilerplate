const { bsv, Bytes, toHex, signTx } = require("scryptlib");
const { IssuerDao } = require("../dao/IssuerDao");

const { FungibleTokenDao } = require("../dao/FungibleTokenDao");
const { Net } = require("../lib/net");
const { BlockChainApi } = require("../lib/blockchain-api");
const { genSignedTx } = require("./sig");
const ROUTE_CHECK_TYPE_3To3 = "3To3";
const ROUTE_CHECK_TYPE_6To6 = "6To6";
const ROUTE_CHECK_TYPE_10To10 = "10To10";
const ROUTE_CHECK_TYPE_3To100 = "3To100";
const ROUTE_CHECK_TYPE_20To3 = "20To3";
class FtMgr {
  static init({ network, wif, apiTarget, tokenApiPrefix, feeb }) {
    this.network = network;
    this.privateKey = new bsv.PrivateKey.fromWIF(wif);
    this.blockChainApi = new BlockChainApi(apiTarget, network);
    this.tokenApiPrefix = tokenApiPrefix;
    this.feeb = feeb;
  }

  static async postTokenApi(route, param) {
    let ret = await Net.httpPost(`${this.tokenApiPrefix}${route}`, param);
    if (ret.code == 0) {
      return ret.data;
    } else {
      throw `post to tokenApi error:${ret.code}`;
    }
  }

  /**
   * genesis
   * @param {string} tokenName token name.
   * @param {string} tokenSymbol token symbol.
   * @param {number} decimalNum the token amount decimal number.1 bytes
   * @returns
   */
  static async genesis(tokenName, tokenSymbol, decimalNum) {
    const utxoPrivateKey = this.privateKey;
    const utxoPublicKey = bsv.PublicKey.fromPrivateKey(utxoPrivateKey);
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

    const issuerPrivateKey = this.privateKey;
    const issuerPublicKey = bsv.PublicKey.fromPrivateKey(issuerPrivateKey);

    let utxos = await this.blockChainApi.getUnspents(utxoAddress);
    let preTxHex = await this.blockChainApi.getRawTxData(utxos[0].txId);

    let { raw, outputs, sigtype } = await this.postTokenApi("/genesis", {
      issuerPk: toHex(issuerPublicKey),
      tokenName,
      tokenSymbol,
      decimalNum,
      utxos,
      utxoAddress: toHex(utxoAddress),
      feeb: this.feeb,
      network: this.network,
    });

    let tx = genSignedTx(
      raw,
      outputs,
      sigtype,
      issuerPrivateKey,
      utxoPrivateKey
    );
    let txid = await this.blockChainApi.broadcast(tx.serialize());

    //save genesis info
    await IssuerDao.insertIssuer({
      genesisId: txid,
      genesisTxId: txid,
      genesisOutputIndex: 0,
      preTxId: utxos[0].txId,
      preOutputIndex: utxos[0].outputIndex,
      preTxHex,
      txId: tx.id,
      outputIndex: 0,
      txHex: tx.serialize(),
      tokenName,
      tokenSymbol,
      decimalNum,
    });

    console.log("genesis success", txid);
    return {
      genesisId: txid,
    };
  }

  /**
   * 发行token
   * @param {string} genesisId token唯一标识
   * @param {number} tokenAmount 此次要发行的数量，如果发行数量为0，则表示不再允许增发
   * @param {string} address 接受者的地址
   * @param {string} allowIncreaseIssues 是否允许继续增发
   * @returns
   */
  static async issue(genesisId, tokenAmount, address, allowIncreaseIssues) {
    const utxoPrivateKey = this.privateKey;
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

    const issuerPrivateKey = this.privateKey;
    const issuerPublicKey = bsv.PublicKey.fromPrivateKey(issuerPrivateKey);

    let utxos = await this.blockChainApi.getUnspents(utxoAddress);

    let issuer = await IssuerDao.getIssuer(genesisId);
    const genesisTxId = issuer.genesisTxId;
    const genesisOutputIndex = issuer.genesisOutputIndex;

    const preUtxoTxId = issuer.preTxId;
    const preUtxoOutputIndex = issuer.preOutputIndex;
    const preUtxoTxHex = issuer.preTxHex;
    const spendByTxId = issuer.txId;
    const spendByOutputIndex = issuer.outputIndex;
    const spendByTxHex = issuer.txHex;
    const receiverAddress = bsv.Address.fromString(address, this.network);
    let { raw, outputs, sigtype } = await this.postTokenApi("/issue", {
      genesisTxId,
      genesisOutputIndex,
      preUtxoTxId,
      preUtxoOutputIndex,
      preUtxoTxHex,
      spendByTxId,
      spendByOutputIndex,
      spendByTxHex,

      issuerPk: toHex(issuerPublicKey),
      receiverAddress: toHex(receiverAddress),
      tokenAmount,
      allowIncreaseIssues,
      oracleSelecteds: [0, 1],

      utxos,
      utxoAddress: toHex(utxoAddress),
      feeb: this.feeb,
      network: this.network,
    });

    let tx = genSignedTx(
      raw,
      outputs,
      sigtype,
      issuerPrivateKey,
      utxoPrivateKey
    );
    let txid = await this.blockChainApi.broadcast(tx.serialize());

    //更新发行合约信息
    IssuerDao.updateIssuer(genesisId, {
      genesisTxId: tx.id,
      genesisOutputIndex: 0,
      preTxId: issuer.txId,
      preTxHex: issuer.txHex,
      preOutputIndex: issuer.outputIndex,
      txId: tx.id,
      outputIndex: 0,
      txHex: tx.serialize(),
    });

    //保存产出的token合约UTXO的信息
    FungibleTokenDao.addUtxos(address, [
      {
        genesisId,
        txId: txid,
        satoshis: tx.outputs[1].satoshis,
        outputIndex: 1, //固定在1号位
        rootHeight: 0,
        lockingScript: tx.outputs[1].script.toHex(),
        txHex: tx.serialize(),
        tokenAddress: address,
        tokenAmount,
        preTxId: spendByTxId,
        preOutputIndex: spendByOutputIndex,
        preTxHex: spendByTxHex,
        preTokenAddress: address,
        preTokenAmount: 0,
      },
    ]);

    console.log("issue success", txid);
    return {
      txId: txid,
    };
  }
  /**
   * 转移token
   * @param {string} genesisId token唯一标识
   * @param {string} senderWif 发送者的wif
   * @param {array} receivers 输出列表
   * @returns
   */
  static async transfer(genesisId, senderWif, receivers) {
    const utxoPrivateKey = this.privateKey;
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

    const senderPrivateKey = new bsv.PrivateKey.fromWIF(senderWif);
    const senderPublicKey = bsv.PublicKey.fromPrivateKey(senderPrivateKey);

    let tokenOutputArray = receivers.map((v) => ({
      address: bsv.Address.fromString(v.address, this.network),
      tokenAmount: v.amount,
    }));

    let ftUtxos = [];
    let outputTokenAmountSum = tokenOutputArray.reduce(
      (pre, cur) => pre + BigInt(cur.tokenAmount),
      0n
    );

    let _ftUtxos = await FungibleTokenDao.getUtxos(
      senderPrivateKey.toAddress(this.network).toString(),
      genesisId
    );
    let inputTokenAmountSum = 0n;
    for (let i = 0; i < _ftUtxos.length; i++) {
      let ftUtxo = _ftUtxos[i];
      ftUtxos.push(ftUtxo);
      inputTokenAmountSum += BigInt(ftUtxo.tokenAmount);
      if (inputTokenAmountSum >= outputTokenAmountSum) {
        break;
      }
    }

    if (inputTokenAmountSum < outputTokenAmountSum) {
      throw "insufficent token";
    }
    console.log(inputTokenAmountSum, outputTokenAmountSum);
    let changeTokenAmount = inputTokenAmountSum - outputTokenAmountSum;
    if (changeTokenAmount > 0n) {
      tokenOutputArray.push({
        address: senderPrivateKey.toAddress(this.network),
        tokenAmount: changeTokenAmount,
      });
    }

    let routeCheckType;
    if (ftUtxos.length <= 3) {
      if (tokenOutputArray.length <= 3) {
        routeCheckType = ROUTE_CHECK_TYPE_3To3;
      } else if (tokenOutputArray.length <= 100) {
        routeCheckType = ROUTE_CHECK_TYPE_3To100;
      } else {
        throw "unsupport token output count";
      }
    } else if (ftUtxos.length <= 6) {
      if (tokenOutputArray.length <= 6) {
        routeCheckType = ROUTE_CHECK_TYPE_6To6;
      } else {
        throw "unsupport token output count";
      }
    } else if (ftUtxos.length <= 10) {
      if (tokenOutputArray.length <= 10) {
        routeCheckType = ROUTE_CHECK_TYPE_10To10;
      } else {
        throw "unsupport token output count";
      }
    } else if (ftUtxos.length <= 20) {
      if (tokenOutputArray.length <= 3) {
        routeCheckType = ROUTE_CHECK_TYPE_20To3;
      } else {
        throw "unsupport token output count";
      }
    } else {
      throw "unsupport token input count";
    }

    let utxos = await this.blockChainApi.getUnspents(utxoAddress);
    let _res = await this.postTokenApi("/routeCheck", {
      senderPk: toHex(senderPublicKey),
      receivers,
      ftUtxos,
      routeCheckType: ROUTE_CHECK_TYPE_3To3,
      oracleSelecteds: [0, 1],

      utxos,
      utxoAddress: toHex(utxoAddress),
      feeb: this.feeb,
      network: this.network,
    });
    let routeCheckTx = genSignedTx(
      _res.raw,
      _res.outputs,
      _res.sigtype,
      senderPrivateKey,
      utxoPrivateKey
    );
    await this.blockChainApi.broadcast(routeCheckTx.serialize());
    console.log("send routeCheckTx success", routeCheckTx.id);

    utxos = await this.blockChainApi.getUnspents(utxoAddress);
    _res = await this.postTokenApi("/transfer", {
      senderPk: toHex(senderPublicKey),
      receivers,
      ftUtxos,
      routeCheckType,
      routeCheckHex: routeCheckTx.serialize(),
      oracleSelecteds: [0, 1],

      utxos,
      utxoAddress: toHex(utxoAddress),
      feeb: this.feeb,
      network: this.network,
    });
    let tx = genSignedTx(
      _res.raw,
      _res.outputs,
      _res.sigtype,
      senderPrivateKey,
      utxoPrivateKey
    );
    let txid = await this.blockChainApi.broadcast(tx.serialize());
    console.log("send transfer success", txid);

    //db更新token合约UTXO的信息
    tokenOutputArray.forEach((v, index) => {
      FungibleTokenDao.addUtxos(v.address.toString(), [
        {
          genesisId,
          txId: txid,
          satoshis: tx.outputs[index].satoshis,
          outputIndex: index,
          rootHeight: 0,
          lockingScript: tx.outputs[index].script.toHex(),
          tokenAddress: v.address.toString(),
          tokenAmount: v.tokenAmount,
          txHex: tx.serialize(),
          preTxId: ftUtxos[0].txId,
          preOutputIndex: ftUtxos[0].outputIndex,
          preTxHex: ftUtxos[0].txHex,
          preTokenAddress: ftUtxos[0].tokenAddress,
          preTokenAmount: ftUtxos[0].tokenAmount,
        },
      ]);
    });

    ftUtxos.forEach((v) => {
      FungibleTokenDao.removeUtxo(
        senderPrivateKey.toAddress(this.network).toString(),
        v.txId,
        v.outputIndex
      );
    });

    return {
      txId: txid,
    };
  }
}

module.exports = {
  FtMgr,
};
