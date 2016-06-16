var HLSID3 = {
  src: null,
  timer: null,
  fragments: {}
};
const PESTIMESCALE = 90000;

function HLSID3_attachSource(source, currentTimeFn, cbobj) {
  HLSID3.src = source;
  HLSID3.currentTimeFn = currentTimeFn;
  HLSID3.adStart = { Cb: cbobj.adStartCb, fired: false };
  HLSID3.adStop = { Cb: cbobj.adStopCb, fired: true };
  HLSID3.timer = setInterval(_handleTick, 1000);
  HLSID3.timeOffset = -1;
  HLSID3.playerStartTime = -1;
  HLSID3_reset();
}

function HLSID3_setPlayerStartTime(startTime) {
  HLSID3.playerStartTime = startTime;
  _updateTimeOffset();
}


function HLSID3_reset() {
  HLSID3.id3Track = { type: 'id3', id: -1, samples: [] };
  HLSID3.aacTrack = { container: 'video/mp2t', type: 'audio', id: -1, samples: [], initPTS: null };
  HLSID3.avcTrack = { container: 'video/mp2t', type: 'video', id: -1, samples: [], nbNalu: 0 }; // Actually not used
  HLSID3.fragments = {};
  HLSID3.aacOverflow = null;
  HLSID3.lastAacPTS = null;
  HLSID3.lastPTSnoAds = null;
  HLSID3.firstPTSnoAds = null;
  HLSID3.timeOffset = 0; // Don't need timeoffset
  HLSID3.fragCount = 0;
  HLSID3.downloadedFragments = {};
  HLSID3.nextExpectedFragment = 0;
}

function _handleTick() {
  _loadAndParseMasterPlaylist(HLSID3.src, function(level) {
    _loadAndParseLevelPlaylist(level.url, function(fragments) {
      for(var i=0; i<fragments.length; i++) {
        if(typeof HLSID3.fragments[fragments[i].url] === 'undefined') {
          // console.log('Adding to cache ' + fragments[i].url);
          fragments[i].fno = HLSID3.fragCount++;
          fragments[i].downloaded = false;
          HLSID3.fragments[fragments[i].url] = fragments[i];
        }
      }
    });
  });  

  for (var key in HLSID3.fragments) {
    if (HLSID3.fragments[key].downloaded === false) {
      // console.log('Downloading fragment ('+HLSID3.fragments[key].fno+') ' + HLSID3.fragments[key].url);
      _downloadFragment(HLSID3.fragments[key], function(f) {
        // console.log('Fragment ('+f.fno+') pushed to buffer');
        HLSID3.fragments[f.url].downloaded = true;
      });
    }
  }

  if (HLSID3.downloadedFragments[HLSID3.nextExpectedFragment]) {
    var nextFragment = HLSID3.downloadedFragments[HLSID3.nextExpectedFragment];
    _parseFragment(HLSID3.fragments[nextFragment.url], nextFragment.payload, function(fragment) {
      console.log('Fragment ('+fragment.fno+') parsed (ID3?'+fragment.hasID3+'): '+fragment.url);
      if (HLSID3.timeOffset === -1 && HLSID3.playerStartTime !== -1) {
        _updateTimeOffset(); 
      }
      var aacPts = HLSID3.aacTrack.samples[HLSID3.aacTrack.samples.length-1].npts;
      if (fragment.hasID3) {
        console.log("Ad break: " + HLSID3.lastPTSnoAds + " ("+(HLSID3.lastPTSnoAds + HLSID3.timeOffset)+")");
        // Fire "event"
        if (!HLSID3.adStart.fired) {
          if (HLSID3.lastPTSnoAds) {
            HLSID3.adStart.Cb(HLSID3.lastPTSnoAds + HLSID3.timeOffset);
          } else {
            HLSID3.adStart.Cb(HLSID3.currentTimeFn());
          }
          HLSID3.adStart.fired = true;
          HLSID3.adStop.fired = false;
          HLSID3.firstPTSnoAds = null;
        }
        // This fragment is an ad fragment, do not cache it
        HLSID3.fragments[fragment.url].downloaded = false;
      } else {
        console.log("("+fragment.fno+") ["+fragment.duration+"s] AAC PTS: " + aacPts + " ("+(aacPts + HLSID3.timeOffset)+")");
        HLSID3.lastPTSnoAds = aacPts;
        HLSID3.adStart.fired = false;
        if (!HLSID3.adStop.fired) {
          HLSID3.firstPTSnoAds = aacPts - fragment.duration;
          if (HLSID3.firstPTSnoAds) {
            HLSID3.adStop.Cb(HLSID3.firstPTSnoAds + HLSID3.timeOffset);
            HLSID3.adStop.fired = true;
          }
        }
      }
      HLSID3.nextExpectedFragment++;
    }); 
  }
}

function _updateTimeOffset() {
  if (HLSID3.aacTrack.samples.length > 0 && HLSID3.playerStartTime !== -1) {
    /*
    var firstPts = HLSID3.aacTrack.samples[0].npts;
    HLSID3.timeOffset = HLSID3.playerStartTime - firstPts;  
    console.log("New time offset: " + HLSID3.timeOffset);
    */
  }
}

function _loadAndParseMasterPlaylist(playlisturi, parsedcb) {
  var xhr = new XMLHttpRequest();
  xhr.onloadend = function(event) {
    var xhr = event.target, status = xhr.status;
    if (status >= 200 && status < 300) {
      _parseMasterPlaylist(xhr.response, parsedcb);
    }
  };
  xhr.open('GET', playlisturi, true);
  xhr.send();
}

function _loadAndParseLevelPlaylist(levellisturi, parsedcb) {
  var xhr = new XMLHttpRequest();
  xhr.onloadend = function(event) {
    var xhr = event.target, status = xhr.status;
    if (status >= 200 && status < 300) {
      _parseLevelPlaylist(xhr.response, parsedcb);
    }
  };
  xhr.open('GET', levellisturi, true);
  xhr.send();
}

function _downloadFragment(fragment, downloadedcb) {
  var xhr = new XMLHttpRequest();
  xhr.responseType = 'arraybuffer';
  xhr.onloadend = function(event) {
    var xhr = event.target, status = xhr.status;
    if (status >= 200 && status < 300) {
      var f = {
        fno: fragment.fno,
        payload: xhr.response,
        url: fragment.url
      };
      HLSID3.downloadedFragments[fragment.fno] = f;
      downloadedcb(f);
    }
  };
  xhr.open('GET', fragment.url, true);
  xhr.send();
}

function _extractAttributes(string) {
  const re = /\s*(.+?)\s*=((?:\".*?\")|.*?)(?:,|$)/g;
  var match, attrs = {};
  while ((match = re.exec(string)) !== null) {
    var value = match[2], quote = '"';
     
    if (value.indexOf(quote) === 0 &&
        value.lastIndexOf(quote) === (value.length-1)) {
      value = value.slice(1, -1);
    }
    attrs[match[1]] = value;
  } 
  return attrs;
}

function _parseMasterPlaylist(string, parsedmaster) {
  var result;
  var levels = [];
  const re = /#EXT-X-STREAM-INF:([^\n\r]*)[\r\n]+([^\r\n]+)/g;
  while((result = re.exec(string)) != null) {
    const level = {};
    var attr = _extractAttributes(result[1]);
    var l = {
      bw: attr['BANDWIDTH'],
      url: result[2],
      baseurl: result[2].replace(/^((\w+:)?\/\/[^\/]+\/?).*$/,'$1')
    };
    levels.push(l);
  }
  levels.sort(function(a, b) {return a.bw - b.bw});
  // We only need the lowest level
  parsedmaster(levels[0]);
}

function _parseLevelPlaylist(string, parsedlevel) {
  const re = /#EXTINF:([^\n\r]*)[\r\n]+([^\r\n]+)/g;
  var fragments = [];
  while((result = re.exec(string)) != null) {
    var f = {
      duration: result[1].split(",")[0],
      url: result[2],
      hasID3: false
    };
    fragments.push(f);
  }
  parsedlevel(fragments);
}

function _parseFragment(fragment, payload, parsedfragment) {
  var fragmentdata = {};

  fragmentdata.length = payload.byteLength; 
  fragmentdata.payload = new Uint8Array(payload);

  if (fragmentdata.length > 0 && TS_validTS(fragmentdata.payload)) {
    // console.log("Found TS segment");
    TS_parseTSPackets(fragment, fragmentdata.payload);
  }

  fragment.data = fragmentdata;
  parsedfragment(fragment);
}

//// TS parsing below

function TS_validTS(data) {
  // a TS fragment should contain at least 3 TS packets, a PAT, a PMT, and one PID, each starting with 0x47
  if (data.length >= 3*188 && data[0] === 0x47 && data[188] === 0x47 && data[2*188] === 0x47) {
    return true;
  } else {
    return false;
  }
}

function TS_parseTSPackets(fragment, data) {
  var len = data.length;
  var starti, stt, pid, atf, offset;

  var pmt = {
    id: -1,
    parsed: false
  };
  var id3Data;
  var aacData;
  var avcData;

  // https://en.wikipedia.org/wiki/MPEG_transport_stream
  // PID : Packet Identifier
  // don't parse last TS packet if incomplete
  len -= len % 188;
  // loop through TS packets
  for (start=0; start<len; start += 188) {
    if(data[start] === 0x47) { // Sync byte
      stt = !!(data[start + 1] & 0x40);
      // pid is a 13-bit field starting at the last bit of TS[1]
      pid = ((data[start + 1] & 0x1f) << 8) + data[start + 2];
      atf = (data[start + 3] & 0x30) >> 4;
      // if an adaption field is present, its length is specified by the fifth byte of the TS packet header.
      if (atf > 1) {
        offset = start + 5 + data[start + 4];
        // continue if there is only adaptation field
        if (offset === (start + 188)) {
          continue;
        }
      } else {
        offset = start + 4;
      }
      if (pmt.parsed) { 
        if (pid === HLSID3.avcTrack.id) {
          // We don't care about the video now
        } else if (pid === HLSID3.aacTrack.id) {
          if (stt) {
            if (aacData) {
              TS_parseAACPES(TS_parsePES(aacData));
            }
            aacData = {data: [], size: 0};
          }
          if (aacData) {
            aacData.data.push(data.subarray(offset, start + 188));
            aacData.size += start + 188 - offset;
          }
        } else if (pid === HLSID3.id3Track.id) {
          if (stt) {
            //console.log("pid: "+pid+" === id3.id: "+HLSID3.id3Track.id);
            if (id3Data) {
              TS_parseID3PES(TS_parsePES(id3Data));
              fragment.hasID3 = true;
            }
            id3Data = {data: [], size: 0};
          }
          if (id3Data) {
            id3Data.data.push(data.subarray(offset, start + 188));
            id3Data.size += start + 188 - offset;
          }
        }
      } else {
        if (stt) {
          offset += data[offset] + 1;
        }
        if (pid === 0) {
          // Parse PAT (Program Association Table)
          pmt.id = TS_parsePAT(data, offset);
        } else if (pid === pmt.id) {
          // Parse PMT (Program Map Tables)
          TS_parsePMT(data, offset, pmt);
          pmt.parsed = true;
          //console.log('PMT parsed', HLSID3.id3Track.id, HLSID3.aacTrack.id, HLSID3.avcTrack.id);
        }
      }
    } else {
      console.log('MEDIA ERROR: TS packet did not start with 0x47');
    }
  }

  // Parse last PES packet
  if (id3Data) {
    TS_parseID3PES(TS_parsePES(id3Data));
    fragment.hasID3 = true;
  }
  if (aacData) {
    TS_parseAACPES(TS_parsePES(aacData));
  }
}

function TS_parsePAT(data, offset) {
  var pmtId = (data[offset+10] & 0x1F) << 8 | data[offset+11];
  // skip the PSI header and parse the first PMT entry
  //console.log('PMT PID: ' + pmtId);
  return pmtId;
}

function TS_parsePMT(data, offset, pmtobj) {
  var sectionLength, tableEnd, programInfoLength, pid;
  sectionLength = (data[offset+1] & 0x0f) << 8 | data[offset+2];
  tableEnd = offset + 3 + sectionLength - 4;
  // to determine where the table is, we have to figure out how
  // long the program info descriptors are 
  programInfoLength = (data[offset+10] & 0x0f) << 8 || data[offset+11];
  // advance the offset to the first entry in the mapping table
  offset += 12 + programInfoLength;

  while(offset < tableEnd) {
    pid = (data[offset+1] & 0x1F) << 8 | data[offset+2];
    switch (data[offset]) {
      case 0x0f:
        if (HLSID3.aacTrack.id === -1) {
          HLSID3.aacTrack.id = pid;
        } 
        break;
      // Packetized metadata (ID3)
      case 0x15:
        //console.log('ID3 PID:' + pid);
        HLSID3.id3Track.id = pid;
        break;
      case 0x1b:
        if (HLSID3.avcTrack.id === -1) {
          HLSID3.avcTrack.id = pid;
        }
        break;
      default:
        //console.log('Unknown stream type: ' + data[offset]);
        break;
    }
    offset += ((data[offset+3] & 0x0F) << 8 | data[offset+4]) +5;
  }
}

function TS_parsePES(stream) {
  var i = 0, frag, pesFlags, pesPrefix, pesLen, pesHdrLen, pesData, pesPts, pesDts, payloadStartOffset, data = stream.data;
    //retrieve PTS/DTS from first fragment
    frag = data[0];
    pesPrefix = (frag[0] << 16) + (frag[1] << 8) + frag[2];
    if (pesPrefix === 1) {
      pesLen = (frag[4] << 8) + frag[5];
      pesFlags = frag[7];
      if (pesFlags & 0xC0) {
        /* PES header described here : http://dvd.sourceforge.net/dvdinfo/pes-hdr.html
            as PTS / DTS is 33 bit we cannot use bitwise operator in JS,
            as Bitwise operators treat their operands as a sequence of 32 bits */
        pesPts = (frag[9] & 0x0E) * 536870912 +// 1 << 29
          (frag[10] & 0xFF) * 4194304 +// 1 << 22
          (frag[11] & 0xFE) * 16384 +// 1 << 14
          (frag[12] & 0xFF) * 128 +// 1 << 7
          (frag[13] & 0xFE) / 2;
          // check if greater than 2^32 -1
          if (pesPts > 4294967295) {
            // decrement 2^33
            pesPts -= 8589934592;
          }
        if (pesFlags & 0x40) {
          pesDts = (frag[14] & 0x0E ) * 536870912 +// 1 << 29
            (frag[15] & 0xFF ) * 4194304 +// 1 << 22
            (frag[16] & 0xFE ) * 16384 +// 1 << 14
            (frag[17] & 0xFF ) * 128 +// 1 << 7
            (frag[18] & 0xFE ) / 2;
          // check if greater than 2^32 -1
          if (pesDts > 4294967295) {
            // decrement 2^33
            pesDts -= 8589934592;
          }
        } else {
          pesDts = pesPts;
        }
      }
      pesHdrLen = frag[8];
      payloadStartOffset = pesHdrLen + 9;

      stream.size -= payloadStartOffset;
      //reassemble PES packet
      pesData = new Uint8Array(stream.size);
      while (data.length) {
        frag = data.shift();
        var len = frag.byteLength;
        if (payloadStartOffset) {
          if (payloadStartOffset > len) {
            // trim full frag if PES header bigger than frag
            payloadStartOffset-=len;
            continue;
          } else {
            // trim partial frag if PES header smaller than frag
            frag = frag.subarray(payloadStartOffset);
            len-=payloadStartOffset;
            payloadStartOffset = 0;
          }
        }
        pesData.set(frag, i);
        i+=len;
      }

      return {data: pesData, pts: pesPts, dts: pesDts, len: pesLen};
    } else {
      return null;
    }
}

function TS_parseAACPES(pes) {
  var startOffset = 0;
  var len, offset; 
  var data = pes.data;
  var pts = pes.pts;
  var aacSample;
  var headerLength, frameLength, frameIndex, frameDuration;
  var stamp;
  var aacOverflow = HLSID3.aacOverflow;
  var aacLastPTS = HLSID3.aacLastPTS;

  if (aacOverflow) {
    var tmp = new Uint8Array(aacOverflow.byteLength + data.byteLength);
    tmp.set(aacOverflow, 0);
    tmp.set(data, aacOverflow.byteLength);
    data = tmp;
  }

  // look for ADTS header (0xFFFx)
  for (offset = startOffset, len = data.length; offset < len - 1; offset++) {
    if ((data[offset] === 0xff) && (data[offset+1] & 0xf0) === 0xf0) {
      break;
    }
  }

  var adtsSampleingRates = [
            96000, 88200,
            64000, 48000,
            44100, 32000,
            24000, 22050,
            16000, 12000,
            11025, 8000,
            7350];
  var adtsSampleingIndex = ((data[offset + 2] & 0x3C) >>> 2);

  frameIndex = 0;
  frameDuration = 1024 * 90000 / adtsSampleingRates[adtsSampleingIndex];

  // if last AAC frame is overflowing, we should ensure timestamps are contiguous:
  // first sample PTS should be equal to last sample PTS + frameDuration
  if(aacOverflow && aacLastPTS) {
    var newPTS = aacLastPTS + frameDuration;
    if(Math.abs(newPTS-pts) > 1) {
      pts = newPTS;
    }
  }

  if(HLSID3.aacTrack.initPTS == null) {
    HLSID3.aacTrack.initPTS = pts;
  }

  while ((offset + 5) < len) {
   // The protection skip bit tells us if we have 2 bytes of CRC data at the end of the ADTS header
    headerLength = (!!(data[offset + 1] & 0x01) ? 7 : 9);
    // retrieve frame size
    frameLength = ((data[offset + 3] & 0x03) << 11) |
                   (data[offset + 4] << 3) |
                  ((data[offset + 5] & 0xE0) >>> 5);
    frameLength  -= headerLength;
    //stamp = pes.pts;

    if ((frameLength > 0) && ((offset + headerLength + frameLength) <= len)) {
      stamp = pts + frameIndex * frameDuration;
      aacSample = {unit: data.subarray(offset + headerLength, offset + headerLength + frameLength), pts: stamp, dts: stamp, npts: (stamp - HLSID3.aacTrack.initPTS) / PESTIMESCALE };
      HLSID3.aacTrack.samples.push(aacSample);
      HLSID3.aacTrack.len += frameLength;
      offset += frameLength + headerLength;
      frameIndex++;
      // look for ADTS header (0xFFFx)
      for ( ; offset < (len - 1); offset++) {
        if ((data[offset] === 0xff) && ((data[offset + 1] & 0xf0) === 0xf0)) {
          break;
        }
      }
    } else {
      break;
    }
  }
  if (offset < len) {
    aacOverflow = data.subarray(offset, len);
    console.log('AAC overflow detected');
  } else {
    aacOverflow = null;
  }
  HLSID3.aacOverflow = aacOverflow;
  HLSID3.aacLastPTS = stamp;
}

function TS_parseID3PES(pes) {
  HLSID3.id3Track.samples.push(pes);
}


