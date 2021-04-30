const { bsv, Bytes, toHex, signTx } = require("scryptlib");
const { IssuerDao } = require("../dao/IssuerDao");

const { FungibleTokenDao } = require("../dao/FungibleTokenDao");
const { Net } = require("../lib/net");
const { BlockChainApi } = require("../lib/blockchain-api");
const { genSignedTx } = require("./sig");
const { FeeWallt } = require("./FeeWallt");
const ROUTE_CHECK_TYPE_3To3 = "3To3";
const ROUTE_CHECK_TYPE_6To6 = "6To6";
const ROUTE_CHECK_TYPE_10To10 = "10To10";
const ROUTE_CHECK_TYPE_3To100 = "3To100";
const ROUTE_CHECK_TYPE_20To3 = "20To3";

const SIZE_OF_TOKEN = 7367;
const SIZE_OF_ROUTE_CHECK_TYPE_3To3 = 6362;
const SIZE_OF_ROUTE_CHECK_TYPE_6To6 = 10499;
const SIZE_OF_ROUTE_CHECK_TYPE_10To10 = 16015;
const SIZE_OF_ROUTE_CHECK_TYPE_3To100 = 52244;
const SIZE_OF_ROUTE_CHECK_TYPE_20To3 = 21765;
const BASE_UTXO_FEE = 1000;
const BASE_FEE = 52416;
class FtMgr {
  static init({ network, apiTarget, tokenApiPrefix, feeb, feeWallets }) {
    this.network = network;
    this.blockChainApi = new BlockChainApi(apiTarget, network);
    this.tokenApiPrefix = tokenApiPrefix;
    this.feeb = feeb;
    this.feeWalletMap = {};
    feeWallets.forEach((v) => {
      this.feeWalletMap[v.addressBy] = new FeeWallt({
        network,
        apiTarget,
        feeb,
        wif: v.wif,
        unitSatoshis: v.unitSatoshis,
      });
      if (!v.addressBy) {
        this.defaultFeeWallet = this.feeWalletMap[v.addressBy];
      }
    });
  }

  static getFeeWallet(addressBy) {
    let feeWallet = this.feeWalletMap[addressBy];
    if (!feeWallet) {
      feeWallet = this.defaultFeeWallet;
    }
    return feeWallet;
  }

  static getDustThreshold(lockingScriptSize) {
    return 3 * Math.ceil((250 * (lockingScriptSize + 9 + 148)) / 1000);
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
  static async genesis(genesisWif, tokenName, tokenSymbol, decimalNum) {
    const issuerPrivateKey = new bsv.PrivateKey.fromWIF(genesisWif);
    const issuerPublicKey = bsv.PublicKey.fromPrivateKey(issuerPrivateKey);
    const issuerAddress = issuerPrivateKey.toAddress(this.network);

    const feeWallet = this.getFeeWallet(issuerAddress.toString());

    const utxoPrivateKey = feeWallet.privateKey;
    const utxoPublicKey = bsv.PublicKey.fromPrivateKey(utxoPrivateKey);
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

    const estimateSatoshis = BASE_FEE;
    return await feeWallet.tryUseUtxos(estimateSatoshis, async (utxos) => {
      let preTxHex = await this.blockChainApi.getRawTxData(utxos[0].txId);
      utxos.forEach((utxo) => {
        utxo.address = toHex(utxoAddress);
      });
      let utxoPrivateKeys = utxos.map((v) => utxoPrivateKey);
      let { raw, outputs, sigtype } = await this.postTokenApi("/genesis", {
        issuerPk: toHex(issuerPublicKey),
        tokenName,
        tokenSymbol,
        decimalNum,
        utxos,
        changeAddress: toHex(utxoAddress),
        feeb: this.feeb,
        network: this.network,
      });

      let tx = genSignedTx(
        raw,
        outputs,
        sigtype,
        issuerPrivateKey,
        utxoPrivateKeys
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

      await feeWallet.addUtxos([
        {
          txId: txid,
          satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
          outputIndex: tx.outputs.length - 1,
          rootHeight: Date.now(),
        },
      ]);

      return {
        genesisId: txid,
      };
    });
  }

  /**
   * 发行token
   * @param {string} genesisId token唯一标识
   * @param {number} tokenAmount 此次要发行的数量，如果发行数量为0，则表示不再允许增发
   * @param {string} address 接受者的地址
   * @param {string} allowIncreaseIssues 是否允许继续增发
   * @returns
   */
  static async issue(
    genesisWif,
    genesisId,
    tokenAmount,
    address,
    allowIncreaseIssues
  ) {
    const issuerPrivateKey = new bsv.PrivateKey(genesisWif);
    const issuerPublicKey = bsv.PublicKey.fromPrivateKey(issuerPrivateKey);
    const issuerAddress = issuerPrivateKey.toAddress(this.network);

    const feeWallet = this.getFeeWallet(issuerAddress.toString());
    const utxoPrivateKey = feeWallet.privateKey;
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

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

    const estimateSatoshis =
      (SIZE_OF_TOKEN * 2 + SIZE_OF_TOKEN + SIZE_OF_TOKEN) * this.feeb +
      this.getDustThreshold(SIZE_OF_TOKEN);
    return await feeWallet.tryUseUtxos(estimateSatoshis, async (utxos) => {
      utxos.forEach((utxo) => {
        utxo.address = toHex(utxoAddress);
      });
      let utxoPrivateKeys = utxos.map((v) => utxoPrivateKey);
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
        signerSelecteds: [0, 1],

        utxos,
        changeAddress: toHex(utxoAddress),
        feeb: this.feeb,
        network: this.network,
      });

      let tx = genSignedTx(
        raw,
        outputs,
        sigtype,
        issuerPrivateKey,
        utxoPrivateKeys
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

      let tokenOutputIndex = allowIncreaseIssues ? 1 : 0;
      //保存产出的token合约UTXO的信息
      FungibleTokenDao.addUtxos(address, [
        {
          genesisId,
          txId: txid,
          satoshis: tx.outputs[tokenOutputIndex].satoshis,
          outputIndex: tokenOutputIndex,
          rootHeight: 0,
          lockingScript: tx.outputs[tokenOutputIndex].script.toHex(),
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

      await feeWallet.addUtxos([
        {
          txId: txid,
          satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
          outputIndex: tx.outputs.length - 1,
          rootHeight: Date.now(),
        },
      ]);
      return {
        txId: txid,
      };
    });
  }
  /**
   * 转移token
   * @param {string} genesisId token唯一标识
   * @param {string} senderWif 发送者的wif
   * @param {array} receivers 输出列表
   * @returns
   */
  static async transfer(genesisId, senderWif, receivers) {
    const senderPrivateKey = new bsv.PrivateKey.fromWIF(senderWif);
    const senderPublicKey = bsv.PublicKey.fromPrivateKey(senderPrivateKey);
    const senderAddress = senderPrivateKey.toAddress(this.network);
    const feeWallet = this.getFeeWallet(senderAddress.toString());

    const utxoPrivateKey = feeWallet.privateKey;
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

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
      console.log(`input ft: ${ftUtxo.txId} ${ftUtxo.outputIndex}`);
      inputTokenAmountSum += BigInt(ftUtxo.tokenAmount);
      if (inputTokenAmountSum >= outputTokenAmountSum) {
        break;
      }
    }

    console.log(inputTokenAmountSum);
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
    let inputLength = ftUtxos.length;
    let outputLength = tokenOutputArray.length;
    let sizeOfRouteCheck = 0;
    if (inputLength <= 3) {
      if (outputLength <= 3) {
        routeCheckType = ROUTE_CHECK_TYPE_3To3;
        sizeOfRouteCheck = SIZE_OF_ROUTE_CHECK_TYPE_3To3;
      } else if (outputLength <= 100) {
        routeCheckType = ROUTE_CHECK_TYPE_3To100;
        sizeOfRouteCheck = SIZE_OF_ROUTE_CHECK_TYPE_3To100;
      } else {
        throw `unsupport transfer from inputs(${inputLength}) to outputs(${outputLength})`;
      }
    } else if (inputLength <= 6) {
      if (outputLength <= 6) {
        routeCheckType = ROUTE_CHECK_TYPE_6To6;
        sizeOfRouteCheck = SIZE_OF_ROUTE_CHECK_TYPE_6To6;
      } else {
        throw `unsupport transfer from inputs(${inputLength}) to outputs(${outputLength})`;
      }
    } else if (inputLength <= 10) {
      if (outputLength <= 10) {
        routeCheckType = ROUTE_CHECK_TYPE_10To10;
        sizeOfRouteCheck = SIZE_OF_ROUTE_CHECK_TYPE_10To10;
      } else {
        throw `unsupport transfer from inputs(${inputLength}) to outputs(${outputLength})`;
      }
    } else if (inputLength <= 20) {
      if (outputLength <= 3) {
        routeCheckType = ROUTE_CHECK_TYPE_20To3;
        sizeOfRouteCheck = SIZE_OF_ROUTE_CHECK_TYPE_20To3;
      } else {
        throw `unsupport transfer from inputs(${inputLength}) to outputs(${outputLength})`;
      }
    } else {
      await this.merge(genesisId, senderWif);
      throw "please try again later";
    }
    let routeCheckTx;
    let estimateSatoshis =
      sizeOfRouteCheck * this.feeb +
      this.getDustThreshold(sizeOfRouteCheck) +
      BASE_UTXO_FEE;
    await feeWallet.tryUseUtxos(estimateSatoshis, async (utxos) => {
      utxos.forEach((utxo) => {
        utxo.address = toHex(utxoAddress);
      });
      let utxoPrivateKeys = utxos.map((v) => utxoPrivateKey);
      let _res = await this.postTokenApi("/routeCheck", {
        senderPk: toHex(senderPublicKey),
        receivers,
        ftUtxos,
        routeCheckType,
        signerSelecteds: [0, 1],

        utxos,
        changeAddress: toHex(utxoAddress),
        feeb: this.feeb,
        network: this.network,
      });

      let tx = genSignedTx(
        _res.raw,
        _res.outputs,
        _res.sigtype,
        senderPrivateKey,
        utxoPrivateKeys
      );
      await this.blockChainApi.broadcast(tx.serialize());
      console.log("send routeCheckTx success", tx.id);
      routeCheckTx = tx;
      await feeWallet.addUtxos([
        {
          txId: tx.id,
          satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
          outputIndex: tx.outputs.length - 1,
          rootHeight: Date.now(),
        },
      ]);
    });

    estimateSatoshis =
      (sizeOfRouteCheck +
        SIZE_OF_TOKEN * inputLength +
        SIZE_OF_TOKEN * inputLength * 2 +
        SIZE_OF_TOKEN * outputLength) *
        this.feeb +
      this.getDustThreshold(SIZE_OF_TOKEN) * outputLength -
      this.getDustThreshold(SIZE_OF_TOKEN) * inputLength -
      this.getDustThreshold(sizeOfRouteCheck) +
      BASE_UTXO_FEE;
    return await feeWallet.tryUseUtxos(estimateSatoshis, async (utxos) => {
      utxos.forEach((utxo) => {
        utxo.address = toHex(utxoAddress);
      });
      let utxoPrivateKeys = utxos.map((v) => utxoPrivateKey);
      let _res = await this.postTokenApi("/transfer", {
        senderPk: toHex(senderPublicKey),
        receivers,
        ftUtxos,
        routeCheckType,
        routeCheckHex: routeCheckTx.serialize(),
        signerSelecteds: [0, 1],

        utxos,
        changeAddress: toHex(utxoAddress),
        feeb: this.feeb,
        network: this.network,
      });
      let tx = genSignedTx(
        _res.raw,
        _res.outputs,
        _res.sigtype,
        senderPrivateKey,
        utxoPrivateKeys
      );
      let txid = await this.blockChainApi.broadcast(tx.serialize(true));
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
            tokenAmount: v.tokenAmount.toString(),
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

      await feeWallet.addUtxos([
        {
          txId: tx.id,
          satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
          outputIndex: tx.outputs.length - 1,
          rootHeight: Date.now(),
        },
      ]);

      return {
        txId: txid,
      };
    });
  }

  static async merge(genesisId, senderWif) {
    const senderPrivateKey = new bsv.PrivateKey.fromWIF(senderWif);
    const senderPublicKey = bsv.PublicKey.fromPrivateKey(senderPrivateKey);
    const senderAddress = senderPrivateKey.toAddress(this.network);

    const feeWallet = this.getFeeWallet(senderAddress.toString());
    const utxoPrivateKey = feeWallet.privateKey;
    const utxoAddress = utxoPrivateKey.toAddress(this.network);

    let _ftUtxos = await FungibleTokenDao.getUtxos(
      senderPrivateKey.toAddress(this.network).toString(),
      genesisId
    );
    let ftUtxos = _ftUtxos.slice(0, 20);

    let inputTokenAmountSum = 0n;
    for (let i = 0; i < ftUtxos.length; i++) {
      let ftUtxo = ftUtxos[i];
      inputTokenAmountSum += BigInt(ftUtxo.tokenAmount);
    }

    let tokenOutputArray = [
      {
        address: senderAddress,
        tokenAmount: inputTokenAmountSum,
      },
    ];

    let receivers = tokenOutputArray.map((v) => ({
      address: v.address.toString(),
      amount: v.tokenAmount.toString(),
    }));

    let routeCheckType = ROUTE_CHECK_TYPE_20To3;
    let sizeOfRouteCheck = SIZE_OF_ROUTE_CHECK_TYPE_20To3;
    let routeCheckTx;
    let estimateSatoshis =
      sizeOfRouteCheck * this.feeb +
      this.getDustThreshold(sizeOfRouteCheck) +
      BASE_UTXO_FEE;
    await feeWallet.tryUseUtxos(estimateSatoshis, async (utxos) => {
      utxos.forEach((utxo) => {
        utxo.address = toHex(utxoAddress);
      });
      let utxoPrivateKeys = utxos.map((v) => utxoPrivateKey);
      let _res = await this.postTokenApi("/routeCheck", {
        senderPk: toHex(senderPublicKey),
        receivers,
        ftUtxos,
        routeCheckType,
        signerSelecteds: [0, 1],

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
        utxoPrivateKeys
      );
      await this.blockChainApi.broadcast(tx.serialize());
      console.log("send routeCheckTx success", tx.id);

      await feeWallet.addUtxos([
        {
          txId: tx.id,
          satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
          outputIndex: tx.outputs.length - 1,
          rootHeight: Date.now(),
        },
      ]);
      routeCheckTx = tx;
    });

    estimateSatoshis =
      (sizeOfRouteCheck +
        SIZE_OF_TOKEN * inputLength +
        SIZE_OF_TOKEN * inputLength * 2 +
        SIZE_OF_TOKEN * outputLength) *
        this.feeb +
      this.getDustThreshold(SIZE_OF_TOKEN) * outputLength -
      this.getDustThreshold(SIZE_OF_TOKEN) * inputLength -
      this.getDustThreshold(sizeOfRouteCheck) +
      BASE_UTXO_FEE;
    return await feeWallet.tryUseUtxos(estimateSatoshis, async (utxos) => {
      utxos.forEach((utxo) => {
        utxo.address = toHex(utxoAddress);
      });
      let utxoPrivateKeys = utxos.map((v) => utxoPrivateKey);
      _res = await this.postTokenApi("/transfer", {
        senderPk: toHex(senderPublicKey),
        receivers,
        ftUtxos,
        routeCheckType,
        routeCheckHex: routeCheckTx.serialize(),
        signerSelecteds: [0, 1],

        utxos,
        changeAddress: toHex(utxoAddress),
        feeb: this.feeb,
        network: this.network,
      });
      let tx = genSignedTx(
        _res.raw,
        _res.outputs,
        _res.sigtype,
        senderPrivateKey,
        utxoPrivateKeys
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
            tokenAmount: v.tokenAmount.toString(),
            txHex: tx.serialize(),
            preTxId: ftUtxos[0].txId,
            preOutputIndex: ftUtxos[0].outputIndex,
            preTxHex: ftUtxos[0].txHex,
            preTokenAddress: ftUtxos[0].tokenAddress,
            preTokenAmount: ftUtxos[0].tokenAmount.toString(),
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

      await feeWallet.addUtxos([
        {
          txId: tx.id,
          satoshis: tx.outputs[tx.outputs.length - 1].satoshis,
          outputIndex: tx.outputs.length - 1,
          rootHeight: Date.now(),
        },
      ]);

      return {
        txId: txid,
      };
    });
  }
}

module.exports = {
  FtMgr,
};
