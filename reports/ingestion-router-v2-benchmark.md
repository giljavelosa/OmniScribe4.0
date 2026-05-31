# Ingestion Router V2 Benchmark

Generated: 2026-05-30T01:22:20.038Z

Mode: mock LLM/OCR unless live provider environment variables are explicitly wired in future work.

| fixture_name | file_type | page_count | detected_route | text_layer_usable_yes_no | ocr_used_yes_no | extracted_character_count | extraction_duration_ms | ocr_duration_ms | normalization_duration_ms | llm_duration_ms | total_to_clinician_review_ready_ms | estimated_ocr_cost | estimated_llm_input_tokens | estimated_llm_output_tokens | estimated_llm_cost | benchmark_mode_mock_or_live | pass_fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Original 40-page John Alvarez synthetic PDF | pdf | 40 | pdf_text_layer | yes | no | 87808 | 10 | 0 | 9 | 5 | 15 | $0.0000 | 21952 | 1469 | $0.0000 | mock | pass |
| Scanned/image-only clone | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture tests/fixtures/ingestion/OmniScribe_John_Alvarez_SCANNED_CLONE_150dpi_image_only.pdf |
| Single-page lab screenshot/image | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture tests/fixtures/ingestion/single-page-lab-screenshot.png |
| DOCX clinical note | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture tests/fixtures/ingestion/clinical-note.docx |
| CSV lab file | skipped | 0 | skipped | no | no | 0 | 0 | 0 | 0 | 0 | 0 | $0.0000 | 0 | 0 | $0.0000 | mock | skipped: missing optional fixture tests/fixtures/ingestion/labs.csv |
