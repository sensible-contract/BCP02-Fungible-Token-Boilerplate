const { app } = require("../app");
const { ErrCode, Utxo } = require("../const");
const { CodeError } = require("../util/CodeError");

class FungibleTokenDao {
  static getDB() {
    return app.dao.getClient("main");
  }

  static getUtxos(address, genesisId) {
    console.log("getUtx", address);
    return new Promise((resolve, reject) => {
      this.getDB()
        .collection("ft_utxos_" + address)
        .find({ genesisId })
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
        .collection("ft_utxos_" + address)
        .insertMany(utxos, (err, res) => {
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
        .collection("ft_utxos_" + address)
        .deleteOne({ txId, outputIndex }, (err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR));
            return;
          }
          resolve(res);
        });
    });
  }

  // static updateUtxo(genesisId, txId, outputIndex, utxo) {
  //   return new Promise((resolve, reject) => {
  //     this.getDB()
  //       .collection("ft_utxos_" + genesisId)
  //       .updateOne({ txId, outputIndex }, { $set: utxo }, (err, res) => {
  //         if (err) {
  //           reject(new CodeError(ErrCode.EC_DAO_ERROR));
  //           return;
  //         }
  //         resolve(res);
  //       });
  //   });
  // }
}

module.exports = {
  FungibleTokenDao,
};
