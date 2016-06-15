# Example

```javascript
player.src = playlist;
var cbobj = {
  adStartCb: function(t) {
  console.log("Detected ad break at: " + t + ", current=" + player.currentTime);
  },
  adStopCb: function(t) {
  }
};
HLSID3_attachSource(player.src, function() { return player.currentTime; }, cbobj);
player.play();

