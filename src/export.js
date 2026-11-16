// Export als TCX (Garmin Training Center XML) – lässt sich in gängige
// Trainingsplattformen hochladen. Indoor-Fahrten werden ohne GPS-Position exportiert.

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function buildTCX(samples, stats, startTime, name = 'Radeln') {
  const iso = (t) => new Date(startTime.getTime() + t * 1000).toISOString();
  const pts = samples.map((s) => {
    let x = `<Trackpoint><Time>${iso(s.t)}</Time>`;
    x += `<AltitudeMeters>${s.elev.toFixed(1)}</AltitudeMeters>`;
    x += `<DistanceMeters>${s.dist.toFixed(1)}</DistanceMeters>`;
    if (s.hr > 0) x += `<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>`;
    x += `<Cadence>${Math.min(254, Math.round(s.cadence))}</Cadence>`;
    x += `<Extensions><ns3:TPX><ns3:Speed>${s.speed.toFixed(2)}</ns3:Speed><ns3:Watts>${Math.round(s.power)}</ns3:Watts></ns3:TPX></Extensions>`;
    return x + '</Trackpoint>';
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Biking"><Id>${iso(0)}</Id>
<Lap StartTime="${iso(0)}"><TotalTimeSeconds>${stats.duration}</TotalTimeSeconds><DistanceMeters>${stats.distance.toFixed(1)}</DistanceMeters><Calories>${Math.round(stats.kcal)}</Calories>${stats.avgHr ? `<AverageHeartRateBpm><Value>${Math.round(stats.avgHr)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.round(stats.maxHr)}</Value></MaximumHeartRateBpm>` : ''}<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>
${pts.join('\n')}
</Track></Lap>
<Notes>${esc(name)}</Notes>
</Activity></Activities>
</TrainingCenterDatabase>
`;
}

export function download(filename, text, mime = 'application/xml') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
