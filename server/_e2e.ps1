$base = 'http://localhost:5050/api'
function J($r) { if ($r -is [string]) { return $r | ConvertFrom-Json } ; $r.Content | ConvertFrom-Json }

$tw = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$sw = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$t = J (Invoke-WebRequest -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ username='smoke_teacher'; password='smoketest123' } | ConvertTo-Json) -WebSession $tw)
"teacher login: $($t.user.name) (id $($t.user.id))"
$s = J (Invoke-WebRequest -Uri "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ username='smoke_student'; password='smoketest123' } | ConvertTo-Json) -WebSession $sw)
"student login: $($s.user.name) (id $($s.user.id))"

$questions = 1..12 | ForEach-Object {
  @{ prompt = "Smoke question $_ ?"; options = @('A','B','C','D'); answer = 0; topic = 'Smoke'; subject = 'Mathematics' }
}
$body = @{
  title = 'SMOKE TEST paper'
  subject = 'Mathematics'
  class_level = 'SS3'
  duration_minutes = 30
  questions = $questions
  sections = @(
    @{ title = 'SECTION A'; kind = 'compulsory'; count = 8; answerAny = $null },
    @{ title = 'SECTION B'; kind = 'optional'; count = 4; answerAny = 2 }
  )
} | ConvertTo-Json -Depth 6

$created = J (Invoke-WebRequest -Uri "$base/exams" -Method Post -ContentType 'application/json' -Body $body -WebSession $tw)
"exam $($created.exam.id) — sections stored: $($created.exam.sections | ConvertTo-Json -Compress)"
$list = J (Invoke-WebRequest -Uri "$base/exams" -WebSession $tw)
"exam list sections: $($list.exams[0].sections | ConvertTo-Json -Compress)"

$id = $created.exam.id
Invoke-WebRequest -Uri "$base/exams/$id/assign" -Method Post -ContentType 'application/json' -Body (@{ studentIds = @($s.user.id) } | ConvertTo-Json) -WebSession $tw | Out-Null

$mine = J (Invoke-WebRequest -Uri "$base/my/exams/$id" -WebSession $sw)
"student sections: $($mine.exam.sections | ConvertTo-Json -Compress)"
"student maxScore=$($mine.exam.maxScore) questions=$($mine.exam.questions.Count) answerKeyHidden=$($mine.exam.questions[0].PSObject.Properties.Name -notcontains 'answer')"

$answers = @{}
0..10 | ForEach-Object { $answers["$_"] = 0 }   # 8 compulsory + 3 optional (quota is 2)
$res = J (Invoke-WebRequest -Uri "$base/my/exams/$id/submit" -Method Post -ContentType 'application/json' -Body (@{ answers = $answers; marked = 1; tabLeaves = 0 } | ConvertTo-Json -Depth 4) -WebSession $sw)
"score: $($res.score)/$($res.total)  (expected 10/10 — the 3rd optional answer is ignored)"
"q9 optional=$($res.review[8].optional) counted=$($res.review[8].counted) section=$($res.review[8].section)"
"q10 counted=$($res.review[9].counted) | q11 counted=$($res.review[10].counted) section=$($res.review[10].section)"

$results = J (Invoke-WebRequest -Uri "$base/exams/$id/results" -WebSession $tw)
"teacher results: $($results.results[0].score)/$($results.results[0].total) for $($results.results[0].student_name)"

Invoke-WebRequest -Uri "$base/exams/$id" -Method Delete -WebSession $tw | Out-Null
$after = J (Invoke-WebRequest -Uri "$base/exams" -WebSession $tw)
"exam deleted: $(-not ($after.exams.id -contains $id))"
"DONE"
