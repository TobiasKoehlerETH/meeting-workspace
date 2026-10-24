//! Saves a meeting transcript as Markdown, plain text or Word (.docx).

use std::io::{Cursor, Write};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

/// One speaker turn: consecutive segments of the same speaker joined into a paragraph.
#[derive(Debug, PartialEq)]
struct Turn { start: Option<f64>, speaker: Option<String>, text: String }

#[derive(Clone, Copy)]
enum Format { Markdown, Text, Word }

impl Format {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "md" => Ok(Self::Markdown),
            "txt" => Ok(Self::Text),
            "docx" => Ok(Self::Word),
            other => Err(format!("Unsupported export format: {other}")),
        }
    }

    fn extension(self) -> &'static str {
        match self { Self::Markdown => "md", Self::Text => "txt", Self::Word => "docx" }
    }

    fn filter_name(self) -> &'static str {
        match self { Self::Markdown => "Markdown", Self::Text => "Text", Self::Word => "Word document" }
    }
}

fn turns(segments: Vec<(String, Option<f64>, Option<String>)>) -> Vec<Turn> {
    let mut turns: Vec<Turn> = Vec::new();
    for (text, start, speaker) in segments {
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        match turns.last_mut() {
            Some(turn) if turn.speaker == speaker => {
                turn.text.push(' ');
                turn.text.push_str(text);
            }
            _ => turns.push(Turn { start, speaker, text: text.to_string() }),
        }
    }
    turns
}

/// Recording-relative time, `[MM:SS]` or `[H:MM:SS]`.
fn timestamp(seconds: Option<f64>) -> String {
    let Some(seconds) = seconds else { return String::new() };
    let total = seconds.max(0.0) as u64;
    let (h, m, s) = (total / 3600, total / 60 % 60, total % 60);
    if h > 0 { format!("[{h}:{m:02}:{s:02}]") } else { format!("[{m:02}:{s:02}]") }
}

/// "[00:12] Anna: " — the part of a line before the spoken text.
fn label(turn: &Turn) -> String {
    let time = timestamp(turn.start);
    let speaker = turn.speaker.as_deref().map(|speaker| format!("{speaker}: ")).unwrap_or_default();
    match (time.is_empty(), speaker.is_empty()) {
        (true, _) => speaker,
        (false, true) => format!("{time} "),
        (false, false) => format!("{time} {speaker}"),
    }
}

fn markdown(title: &str, date: &str, turns: &[Turn]) -> String {
    let mut out = format!("# {title}\n\n{date}\n\n");
    for turn in turns {
        let label = label(turn);
        if label.is_empty() {
            out.push_str(&format!("{}\n\n", turn.text));
        } else {
            out.push_str(&format!("**{}** {}\n\n", label.trim_end(), turn.text));
        }
    }
    out
}

fn text(title: &str, date: &str, turns: &[Turn]) -> String {
    let mut out = format!("{title}\n{date}\n\n");
    for turn in turns {
        out.push_str(&format!("{}{}\n\n", label(turn), turn.text));
    }
    out
}

fn xml_escape(value: &str) -> String {
    value.chars()
        // XML 1.0 forbids most control characters.
        .filter(|c| !c.is_control() || matches!(c, '\t' | '\n' | '\r'))
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            other => other.to_string(),
        })
        .collect()
}

fn docx_run(text: &str, bold: bool, size_half_points: Option<u32>) -> String {
    let mut props = String::new();
    if bold { props.push_str("<w:b/>"); }
    if let Some(size) = size_half_points { props.push_str(&format!("<w:sz w:val=\"{size}\"/>")); }
    let props = if props.is_empty() { props } else { format!("<w:rPr>{props}</w:rPr>") };
    format!("<w:r>{props}<w:t xml:space=\"preserve\">{}</w:t></w:r>", xml_escape(text))
}

/// A minimal WordprocessingML package: content types, package relationships and the document.
fn docx(title: &str, date: &str, turns: &[Turn]) -> Result<Vec<u8>, String> {
    let paragraph = |runs: String| format!("<w:p><w:pPr><w:spacing w:after=\"160\"/></w:pPr>{runs}</w:p>");
    let mut body = paragraph(docx_run(title, true, Some(32)));
    body.push_str(&paragraph(docx_run(date, false, None)));
    for turn in turns {
        let label = label(turn);
        let runs = if label.is_empty() { String::new() } else { docx_run(&label, true, None) };
        body.push_str(&paragraph(runs + &docx_run(&turn.text, false, None)));
    }
    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
         <w:body>{body}<w:sectPr/></w:body></w:document>"
    );
    let parts = [
        ("[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
            <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
            <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
            <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
            </Types>".to_string()),
        ("_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
            </Relationships>".to_string()),
        ("word/document.xml", document),
    ];
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in parts {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

/// A file name Windows, macOS and Linux all accept.
fn file_name(title: &str, extension: &str) -> String {
    let clean: String = title.chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let clean = clean.trim().trim_end_matches('.');
    format!("{}.{extension}", if clean.is_empty() { "Transcript" } else { clean })
}

/// Asks where to save, then writes the meeting's full transcript. Returns the saved path, or None if cancelled.
#[tauri::command]
pub async fn export_meeting_transcript<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    format: String,
) -> Result<Option<String>, String> {
    let format = Format::parse(&format)?;
    let pool = app.state::<crate::state::AppState>().db_manager.pool().clone();
    let meeting = crate::database::repositories::meeting::MeetingsRepository::get_meeting_metadata(&pool, &meeting_id)
        .await.map_err(|e| e.to_string())?
        .ok_or("Meeting not found.")?;
    let segments: Vec<(String, Option<f64>, Option<String>)> = sqlx::query_as(
        "SELECT transcript, audio_start_time, speaker FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC",
    ).bind(&meeting_id).fetch_all(&pool).await.map_err(|e| e.to_string())?;
    let turns = turns(segments);
    if turns.is_empty() {
        return Err("This meeting has no transcript yet.".into());
    }

    let date = meeting.created_at.0.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string();
    let bytes = match format {
        Format::Markdown => markdown(&meeting.title, &date, &turns).into_bytes(),
        Format::Text => text(&meeting.title, &date, &turns).into_bytes(),
        Format::Word => docx(&meeting.title, &date, &turns)?,
    };

    let Some(path) = app.dialog().file()
        .set_file_name(file_name(&meeting.title, format.extension()))
        .add_filter(format.filter_name(), &[format.extension()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the transcript: {e}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<Turn> {
        turns(vec![
            ("Grüezi mitenand.".into(), Some(2.0), Some("Anna".into())),
            ("Wir starten.".into(), Some(4.5), Some("Anna".into())),
            ("  ".into(), Some(6.0), Some("Ben".into())),
            ("Danke <&>".into(), Some(3725.0), Some("Ben".into())),
        ])
    }

    #[test]
    fn joins_consecutive_segments_of_one_speaker() {
        assert_eq!(sample(), [
            Turn { start: Some(2.0), speaker: Some("Anna".into()), text: "Grüezi mitenand. Wir starten.".into() },
            Turn { start: Some(3725.0), speaker: Some("Ben".into()), text: "Danke <&>".into() },
        ]);
    }

    #[test]
    fn renders_markdown_and_text() {
        let turns = sample();
        assert_eq!(markdown("Weekly", "2026-10-24 09:00", &turns),
            "# Weekly\n\n2026-10-24 09:00\n\n**[00:02] Anna:** Grüezi mitenand. Wir starten.\n\n**[1:02:05] Ben:** Danke <&>\n\n");
        assert_eq!(text("Weekly", "2026-10-24 09:00", &turns[..1]),
            "Weekly\n2026-10-24 09:00\n\n[00:02] Anna: Grüezi mitenand. Wir starten.\n\n");
        let unlabelled = [Turn { start: None, speaker: None, text: "Hello".into() }];
        assert_eq!(markdown("T", "D", &unlabelled), "# T\n\nD\n\nHello\n\n");
    }

    #[test]
    fn docx_is_a_word_package_with_escaped_text() {
        let bytes = docx("Q&A", "2026-10-24", &sample()).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<String> = archive.file_names().map(str::to_string).collect();
        for part in ["[Content_Types].xml", "_rels/.rels", "word/document.xml"] {
            assert!(names.iter().any(|name| name == part), "missing {part}");
        }
        let mut document = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("word/document.xml").unwrap(), &mut document).unwrap();
        assert!(document.contains("Q&amp;A"));
        assert!(document.contains("Danke &lt;&amp;&gt;"));
        assert!(document.contains("[00:02] Anna: "));
    }

    #[test]
    fn file_names_are_safe_everywhere() {
        assert_eq!(file_name("Team: Q3/Q4?", "md"), "Team_ Q3_Q4_.md");
        assert_eq!(file_name("  ", "txt"), "Transcript.txt");
    }
}
