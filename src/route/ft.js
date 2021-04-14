const { app } = require("../app");
const { NetMgr } = require("../domain/NetMgr");
const { FtMgr } = require("../domain/FtMgr");
const { FungibleTokenDao } = require("../dao/FungibleTokenDao");
exports.default = function () {
  NetMgr.listen(
    "POST",
    "/api/ft/genesis",
    async function (req, res, params, body) {
      const { genesisWif, tokenName, tokenSymbol, decimalNum } = body;
      return await FtMgr.genesis(
        genesisWif,
        tokenName,
        tokenSymbol,
        decimalNum
      );
    }
  );

  NetMgr.listen(
    "POST",
    "/api/ft/issue",
    async function (req, res, params, body) {
      const {
        genesisWif,
        genesisId,
        tokenAmount,
        receiverAddress,
        allowIncreaseIssues,
      } = body;
      return await FtMgr.issue(
        genesisWif,
        genesisId,
        tokenAmount,
        receiverAddress,
        allowIncreaseIssues
      );
    }
  );

  NetMgr.listen(
    "POST",
    "/api/ft/transfer",
    async function (req, res, params, body) {
      const { genesisId, senderWif, receivers } = body;
      return await FtMgr.transfer(genesisId, senderWif, receivers);
    }
  );

  NetMgr.listen(
    "GET",
    "/api/ft/queryIssueList",
    async function (req, res, params, body) {
      let _res = await FungibleTokenDao.getTableSourceForIssue(params);
      console.log(_res);
      return _res;
    }
  );

  NetMgr.listen(
    "GET",
    "/api/ft/queryAddressBalance",
    async function (req, res, params, body) {
      return await FungibleTokenDao.getTableSource(params);
    }
  );
};
