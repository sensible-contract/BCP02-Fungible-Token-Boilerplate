const { app } = require("../app");
const { ErrCode, Utxo } = require("../const");
const { CodeError } = require("../util/CodeError");

class FungibleTokenDao {
  static getDB() {
    return app.dao.getClient("main");
  }

  static getTableSourceForIssue(params) {
    return new Promise((resolve, reject) => {
      let { pageSize, currentPage, sorter, genesisId } = params;
      pageSize = parseInt(pageSize);
      currentPage = parseInt(currentPage);

      if (!sorter) sorter = "regtime_descend";
      let sorters = sorter.split("_");
      let sortKey = sorters[0];
      let sortSeq = sorters[1] == "ascend" ? 1 : -1;

      if (!pageSize) {
        pageSize = 10;
        currentPage = 1;
      }
      let stages = [];
      if (genesisId) {
        stages.push({ $match: { genesisId } });
      }
      stages = stages.concat([
        {
          $facet: {
            list: [
              { $skip: (currentPage - 1) * pageSize },
              { $limit: pageSize },
              {
                $project: {
                  _id: 0,
                  txId: 1,
                  tokenName: 1,
                  tokenSymbol: 1,
                  decimalNum: 1,
                },
              },
            ],
            count: [{ $group: { _id: null, total: { $sum: 1 } } }],
          },
        },
      ]);
      this.getDB()
        .collection("issuers")
        .aggregate(stages)
        .toArray((err, res) => {
          if (err) {
            reject(new CodeError(ErrCode.EC_DAO_ERROR, err));
            return;
          }
          let total = 0;
          res.forEach((v) => {
            v.count.forEach((w) => {
              total = w.total;
            });
          });
          let tableSource = {
            list: res[0].list,
            pagination: {
              pageSize,
              current: currentPage,
              total,
            },
          };

          resolve(tableSource);
        });
    });
  }

  static getUtxos(address, genesisId) {
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
