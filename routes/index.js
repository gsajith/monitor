var express = require('express');
var router = express.Router();
const gdax = require('gdax');

const btc_usd_client = new gdax.PublicClient("BTC-USD");
const eth_usd_client = new gdax.PublicClient("ETH-USD");
const eth_btc_client = new gdax.PublicClient("ETH-BTC");

/* GET home page. */
router.get('/', function(req, res, next) {
  
  getResults(function(results) { res.render('index', {results: results})}); 
 
});

router.get('/reload', function(req, res) {
  getResults(function(results) {
    res.writeHead(200, "OK", {"Content-Type":"text/html"});
    res.end(results);
  });
});

function getResults(cb) {
  generatePage(cb);
}

function generatePage(cb) {
  var btcAsk, btcBid, ethAsk, ethBid, exchangeAsk, exchangeBid; 
  eth_usd_client.getProductOrderBook((error, response, data) => {
    if (error) {
    } else {
      ethAsk = parseFloat(data["asks"][0][0]);
      ethBid = parseFloat(data["bids"][0][0]);
    }
    btc_usd_client.getProductOrderBook((error, response, data) => {
      if (error) {
      } else {
        btcAsk = parseFloat(data["asks"][0][0]);
        btcBid = parseFloat(data["bids"][0][0]);
        eth_btc_client.getProductOrderBook((error, response, data) => {
        if (error) {
        } else {
          exchangeAsk = parseFloat(data["asks"][0][0]);
          exchangeBid = parseFloat(data["bids"][0][0]);
          ethAvg = parseFloat(ethAsk + ethBid)/2;
          btcAvg = parseFloat(btcAsk + btcBid)/2;
          targetExchange = parseFloat(ethAvg/btcAvg);
          var trade = "False";
          var margin = targetExchange/parseFloat((exchangeAsk + exchangeBid)/2.0);
          if (margin - 1 > .01) {
             trade = "Buy BTC";
          } else if (margin - 1 < -.01) {
             trade = "Buy ETH";
          } else if (margin - 1 > .003) {
             trade = "Light buy BTC";
          } else if (margin - 1 < -.003) {
             trade = "Light buy ETH";
          }
          var retString = "<h1>GDAX Monitor</h1>";
          retString = retString + "<br>Last fetched: " + new Date() + "<br>";
          retString = retString + "<p>BTC ask: $" + btcAsk.toFixed(2) + "</p>";
          retString = retString + "<p>BTC bid: $" + btcBid.toFixed(2) + "</p>";
          retString = retString + "<p>ETH ask: $" + ethAsk.toFixed(2) + "</p>";
          retString = retString + "<p>ETH bid: $" + ethBid.toFixed(2) + "</p>";
          retString = retString + "<p>Exc ask: " + exchangeAsk.toFixed(5) + "</p>";
          retString = retString + "<p>Exc bid: " + exchangeBid.toFixed(5) + "</p>";
          retString = retString + "<p>Target: " + targetExchange.toFixed(5) + "</p>";
          retString = retString + "<p>Margin: " + margin + "</p>";
          retString = retString + "<p>Profit: " + ((margin - 1) * 100).toFixed(5) + "%</p>";
          if (trade != "False") {
            retString = retString + "<p style='color: green; font-size: 80px;'>Trade: " + trade + "</p>";
          } else {
            retString = retString + "<p>Trade: " + trade + "</p>";
          }
          cb(retString);
          //res.render('index', { title: 'GDAX monitor', ethAsk: ethAsk, ethBid: ethBid, btcAsk: btcAsk, btcBid: btcBid, exchangeAsk: exchangeAsk, exchangeBid: exchangeBid, target: targetExchange, margin: margin, trade: trade });
	}
      }); 
      }
    });
  });
}

module.exports = router;
