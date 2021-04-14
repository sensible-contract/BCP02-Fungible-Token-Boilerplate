const { bsv } = require("scryptlib");
const { ErrCode } = require("../const");
const { UtxoDao } = require("../dao/UtxoDao");
const { CodeError } = require("../util/CodeError");
const { BlockChainApi } = require("../lib/blockchain-api");
const Signature = bsv.crypto.Signature;
const sighashType = Signature.SIGHASH_ALL | Signature.SIGHASH_FORKID;
const DUST_FEE = 546;
const LOWEST_BALANCE = 10000;
const MIN_SPLIT = 30;
class FeeWallt {
  constructor({ wif, network, feeb, apiTarget, unitSatoshis }) {
    this.privateKey = new bsv.PrivateKey(wif);
    this.address = this.privateKey.toAddress(network);
    this.addressStr = this.address.toString();
    this.unitSatoshis = unitSatoshis;
    this.feeb = feeb;
    this.blockChainApi = new BlockChainApi(apiTarget, network);
    this.loadUtxos();
    // this.loadOld();
  }
  get balance() {
    return this.utxos.reduce((pre, cur) => cur.satoshis + pre, 0);
  }

  unlockP2PKHInput(privateKey, tx, inputIndex, sigtype) {
    const sig = new bsv.Transaction.Signature({
      publicKey: privateKey.publicKey,
      prevTxId: tx.inputs[inputIndex].prevTxId,
      outputIndex: tx.inputs[inputIndex].outputIndex,
      inputIndex,
      signature: bsv.Transaction.Sighash.sign(
        tx,
        privateKey,
        sigtype,
        inputIndex,
        tx.inputs[inputIndex].output.script,
        tx.inputs[inputIndex].output.satoshisBN
      ),
      sigtype,
    });

    tx.inputs[inputIndex].setScript(
      bsv.Script.buildPublicKeyHashIn(
        sig.publicKey,
        sig.signature.toDER(),
        sig.sigtype
      )
    );
  }

  async loadOld() {
    let oldUtxos = await UtxoDao.getUtxos(this.addressStr);

    this.utxos = oldUtxos;
    await this.adjustUtxos();
  }
  async loadUtxos() {
    let oldUtxos = await UtxoDao.getUtxos(this.addressStr);
    let newUtoxs = await this.blockChainApi.getUnspents(this.addressStr);
    let utxos = [];
    newUtoxs.forEach((newUtxo) => {
      let old = oldUtxos.find(
        (oldUtxo) =>
          oldUtxo.txId == newUtxo.txId &&
          oldUtxo.outputIndex == newUtxo.outputIndex
      );
      if (old) {
        utxos.push(old);
      } else {
        utxos.push({
          txId: newUtxo.txId,
          satoshis: newUtxo.satoshis,
          outputIndex: newUtxo.outputIndex,
          rootHeight: 0,
        });
      }
    });
    await UtxoDao.clearUtoxs(this.addressStr);
    await UtxoDao.addUtxos(this.addressStr, utxos);
    this.utxos = utxos;
    if (this.balance < LOWEST_BALANCE) {
      console.log("insufficient balance.");
    }
    await this.adjustUtxos();
  }

  /**
   * adjust utxos
   * When the amount of utxos smaller than minSplit
   * the max utxo will be splited.
   * @returns
   */
  async adjustUtxos() {
    if (this.utxos.length >= MIN_SPLIT) {
      //Make sure there are more than MAX_SPLIT
      return;
    }

    if (this.utxos.length == 0) {
      console.log("adjustUtxos insufficient balance!");
      return;
    }

    console.log(
      "adjustUtxo utxo count:",
      this.utxos.length,
      "balance:",
      this.balance
    );

    //Find the max value to split
    this.utxos.sort((a, b) => {
      return b.satoshis - a.satoshis;
    });
    let utxo = this.utxos[0];

    if (utxo.satoshis < this.unitSatoshis + DUST_FEE) {
      console.log(
        "adjust Utxos insufficient balance",
        this.addressStr,
        utxo.satoshis,
        this.unitSatoshis + DUST_FEE,
        this.balance
      );
      return;
    }

    // const toSplitCount = Math.min(
    //   Math.floor(utxo.satoshis / this.unitSatoshis),
    //   this.maxSplit - this.utxos.length
    // );
    const toSplitCount = 500;
    // 提取该UTXO，防止被其他并发操作使用
    utxo = this.utxos.splice(0, 1)[0];

    // step 2: build the tx
    const tx = new bsv.Transaction().from({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
      script: bsv.Script.buildPublicKeyHashOut(this.address).toHex(),
    });

    let script = bsv.Script.buildPublicKeyHashOut(this.address);
    let leftSatoshis = utxo.satoshis;
    for (let i = 0; i < toSplitCount; i++) {
      leftSatoshis -= this.unitSatoshis;
      if (leftSatoshis < Math.ceil(tx._estimateSize() * this.feeb)) {
        console.log("Not enough satoshis to split.");
        break;
      }
      if (leftSatoshis > DUST_FEE) {
        tx.addOutput(
          new bsv.Transaction.Output({
            script: script,
            satoshis: this.unitSatoshis,
          })
        );
      }
    }
    tx.change(this.address).fee(
      Math.max(Math.ceil(tx._estimateSize() * this.feeb), DUST_FEE)
    );

    this.unlockP2PKHInput(this.privateKey, tx, 0, sighashType);
    try {
      let _res = await this.blockChainApi.broadcast(tx.serialize());
      // console.log("split success", _res);
      let newUtxos = [];
      tx.outputs.forEach((v, index) => {
        newUtxos.push({
          txId: tx.id,
          satoshis: v.satoshis,
          outputIndex: index,
          rootHeight: 0,
        });
      });
      await UtxoDao.removeUtxo(this.addressStr, utxo.txId, utxo.outputIndex);
      await UtxoDao.addUtxos(this.addressStr, newUtxos);
      this.utxos = this.utxos.concat(newUtxos);
      console.log(
        "split finished. balance:",
        this.balance,
        "utxo count:",
        this.utxos.length
      );
    } catch (e) {
      this.utxos.push(utxo);
      console.error(e);
      throw e;
    } finally {
    }
  }

  /**
   * fetch a batch of utxo
   * @param {number} estimateSatoshis the satoshis estimated to use
   * @returns
   */
  fetchUtxos(estimateSatoshis) {
    if (!this.utxos) return [];
    let validHeight = Date.now() + 1000 * 60 * 10;
    let _utxos = this.utxos.filter((v) => v.rootHeight < validHeight);
    let _leftUtxos = this.utxos.filter((v) => v.rootHeight >= validHeight);
    _utxos.sort((a, b) => b.satoshis - a.satoshis); //
    let sum = 0;

    let utxos = [];
    let c = 0;
    while (sum < estimateSatoshis && _utxos.length > 0) {
      c++;
      if (_utxos[0].satoshis > DUST_FEE) {
        let utxo = _utxos.splice(0, 1)[0];
        sum += utxo.satoshis;
        utxos.push(utxo);
      }

      if (c > 50) {
        break;
      }
    }

    this.utxos = _utxos.concat(_leftUtxos);

    if (sum < estimateSatoshis) {
      this.utxos = this.utxos.concat(utxos);
      console.log(
        "fetch",
        estimateSatoshis,
        "but left",
        this.balance,
        "pick sum is",
        sum
      );
      return [];
    }
    console.log("fetchUtxos", utxos);
    return utxos;
  }

  async addUtxos(newUtxos) {
    console.log("addUtxos", newUtxos);
    this.utxos = this.utxos.concat(newUtxos);
    await UtxoDao.addUtxos(this.addressStr, newUtxos);
  }

  /**
   * put the utxos back into the pool.
   * @param {array} a batch of utxo
   */
  recycleUtxos(utxos) {
    console.log("recycleUtxos", utxos);
    this.utxos = this.utxos.concat(utxos);
  }

  /**
   * try to use a batch of utxo.If the operation failed, then make sure they would be recycled to the pool.
   * @param {number} estimateSatoshis the satoshis estimated to use
   * @param {function} promiseCallback the callback function
   * @returns
   */
  async tryUseUtxos(estimateSatoshis, promiseCallback) {
    const utxos = this.fetchUtxos(estimateSatoshis);
    if (utxos.length == 0) {
      throw new CodeError(ErrCode.EC_TRY_AGAIN_LAYER);
    }
    try {
      let _res = await promiseCallback(utxos);
      utxos.forEach((v) => {
        UtxoDao.removeUtxo(this.addressStr, v.txId, v.outputIndex);
      });
      return _res;
    } catch (e) {
      if (e.resData) {
        if (
          e.resData.body &&
          e.resData.body.includes("too-long-mempool-chain")
        ) {
          utxos.forEach((v) => {
            v.rootHeight++;
            UtxoDao.updateUtxo(this.addressStr, v.txId, v.outputIndex, v);
          });
          console.error(e);
          e = new CodeError(
            ErrCode.EC_TOO_LONG_MEMPOOL_CHAI,
            "too-long-mempool-chain"
          );
        }
      }
      this.recycleUtxos(utxos);
      throw e;
    } finally {
      this.adjustUtxos();
    }
  }
}

module.exports = {
  FeeWallt,
};
