var express = require('express');
var router = express.Router();
const gdax = require('gdax');

const btc_usd_client = new gdax.PublicClient("BTC-USD");
const eth_usd_client = new gdax.PublicClient("ETH-USD");
const eth_btc_client = new gdax.PublicClient("ETH-BTC");
const ltc_btc_client = new gdax.PublicClient("LTC-BTC");
const ltc_usd_client = new gdax.PublicClient("LTC-USD");
var btcAsk, btcBid, ethAsk, ethBid, ltcAsk, ltcBid, ethAvg, btcAvg, ltcAvg, exchangeAsk, exchangeBid, ltcExchangeAsk, ltcExchangeBid, margin, ltcMargin, profit, ltcProfit; 

const websocket = new gdax.WebsocketClient(['BTC-USD', 'ETH-USD']);

websocket.on('message', data => {
  if (data['type'] == 'received') {
     console.log(data);
  }
});

/* GET home page. */
router.get('/', function(req, res, next) {
  getResults(function(results) { res.render('index', results)}); 
});

router.get('/reload', function(req, res) {
  getResults(function(results) {
    res.render('page', results);
  });
});

function getResults(cb) {
  generatePage(cb);
}

function isNull(obj) {
  return !(obj && obj !== 'null' && obj !== 'undefined');
}

function generatePage(cb) {
  eth_usd_client.getProductOrderBook((error, response, data) => {
    if (error || isNull(data)) {
    } else {
      ethAsk = parseFloat(data["asks"][0][0]);
      ethBid = parseFloat(data["bids"][0][0]);
    }
    btc_usd_client.getProductOrderBook((error, response, data) => {
      if (error || isNull(data)) {
      } else {
        btcAsk = parseFloat(data["asks"][0][0]);
        btcBid = parseFloat(data["bids"][0][0]);
        eth_btc_client.getProductOrderBook((error, response, data) => {
          if (error || isNull(data)) {
          } else {
            exchangeAsk = parseFloat(data["asks"][0][0]);
            exchangeBid = parseFloat(data["bids"][0][0]);
            ltc_usd_client.getProductOrderBook((error, response, data) => {
            	if (error || isNull(data)) {
                } else {
                    ltcAsk = parseFloat(data["asks"][0][0]);
                    ltcBid = parseFloat(data["bids"][0][0]);
                    ltc_btc_client.getProductOrderBook((error, response, data) => {
                    	if (error || isNull(data)) {
			} else {
			    ltcExchangeAsk = parseFloat(data["asks"][0][0]);
                            ltcExchangeBid = parseFloat(data["bids"][0][0]);
                            ltcAvg = parseFloat(ltcAsk + ltcBid)/2;
                            var ltcTargetExchange = parseFloat(ltcAvg/btcAvg);
                            ethAvg = parseFloat(ethAsk + ethBid)/2;
                            btcAvg = parseFloat(btcAsk + btcBid)/2;
                            var targetExchange = parseFloat(ethAvg/btcAvg);
                            var trade = "False";
                            margin = targetExchange/parseFloat((exchangeAsk + exchangeBid)/2.0);
                            if (margin - 1 > .01) {
                               trade = "BUY BTC->ETH!!";
                            } else if (margin - 1 < -.01) {
                               trade = "BUY ETH->BTC!!";
                            } else if (margin - 1 > .0017) {
                               trade = "Buy BTC->ETH";
                            } else if (margin - 1 < -.0017) {
                               trade = "Buy ETH->BTC";
                            }
                            profit = ((margin - 1) * 100).toFixed(5);
                            var ltcTrade = "False";
                            ltcMargin = ltcTargetExchange/parseFloat((ltcExchangeAsk + ltcExchangeBid)/2.0);
                            if (ltcMargin - 1 > .01) {
                               ltcTrade = "BUY BTC->LTC!!";
                            } else if (ltcMargin - 1 < -.01) {
                               ltcTrade = "BUY LTC->BTC!!";
                            } else if (ltcMargin - 1 > .0017) {
                               ltcTrade = "Buy BTC->LTC";
                            } else if (ltcMargin - 1 < -.0017) {
                               ltcTrade = "Buy LTC->BTC";
                            }
                            ltcProfit = ((ltcMargin - 1) * 100).toFixed(5);
                            cb({title: "GDAX Monitor", date: new Date(), btcAsk: btcAsk.toFixed(2), btcBid: btcBid.toFixed(2), ethAsk: ethAsk.toFixed(2), ethBid: ethBid.toFixed(2), exchangeAsk: exchangeAsk.toFixed(5), exchangeBid: exchangeBid.toFixed(5), target: targetExchange.toFixed(5), margin: margin, profit: profit, trade: trade, ltcBid: ltcBid.toFixed(2), ltcAsk: ltcAsk.toFixed(2), ltcExchangeAsk: ltcExchangeAsk.toFixed(5), ltcExchangeBid: ltcExchangeBid.toFixed(5), ltcTarget: ltcTargetExchange.toFixed(5), ltcMargin: ltcMargin, ltcProfit: ltcProfit, ltcTrade: ltcTrade})
                	}
                    });
		}
            });
	}
      }); 
      }
    });
  });
}

module.exports = router;

