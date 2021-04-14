const { app } = require("../app");
const { ErrCode } = require("../const");
const { CodeError } = require("../util/CodeError");

class UtxoDao {
  static getDB() {
    return app.dao.getClient("main");
  }

  static getUtxos(address) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .find({})
        .toArray((err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }

          resolve(res);
        });
    });
  }

  static addUtxos(address, utxos) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .insertMany(utxos, (err, res) => {
          if (err) {
            console.log(address, utxos, err);
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }

  static clearUtoxs(address) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .removeMany({}, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }

  static removeUtxo(address, txId, outputIndex) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .deleteOne({ txId, outputIndex }, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }

  static updateUtxo(address, txId, outputIndex, utxo) {
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("utxos_" + address)
        .updateOne({ txId, outputIndex }, { $set: utxo }, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }
}

module.exports = {
  UtxoDao,
};
