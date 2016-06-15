# Example

```javascript
player.src = playlist;
var cbobj = {
  adStartCb: function(t) {
    console.log("Detected ad break at: " + t + ", current=" + player.currentTime);
    adBreakStart = t;
    adBreakStop = null;
  },
  adStopCb: function(t) {
    console.log("Detected ad break stop at: " + t + ", current=" + player.currentTime);
    adBreakStart = null;
    adBreakStop = t; 
  }
};
HLSID3_attachSource(player.src, function() { return player.currentTime; }, cbobj);
player.play();
player.addEventListener('playing', function(ev) {
  HLSID3_setPlayerStartTime(player.currentTime);
});

