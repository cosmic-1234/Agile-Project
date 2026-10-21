import React, { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import DocumentUpload from '../components/DocumentUpload';
import FitmentCard from '../components/FitmentCard';
import LoadingState from '../components/LoadingState';
import BannerCard from '../components/BannerCard';

export default function AnalyzeProblem() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('text');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedForCompare, setSelectedForCompare] = useState([]);

  // Text input state
  const [problemText, setProblemText] = useState('');

  // Document input state
  const [file, setFile] = useState(null);

  const [loadingMsg, setLoadingMsg] = useState('Analyzing...');

  const handleTextAnalysis = async () => {
    if (problemText.trim().length < 10) {
      toast.warning('Insufficient Input', 'Please provide a more detailed problem description.');
      return;
    }
    setLoading(true);
    setResult(null);
    setLoadingMsg('Analyzing...');
    // Show warm-up message after 10s (Render free tier cold start)
    const warmupTimer = setTimeout(() => setLoadingMsg('Server is warming up, please wait...'), 10000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout
    try {
      const response = await fetch('/api/analyze/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemText, industry: 'Manufacturing' }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errData = await response.json();
        if (response.status === 503 || errData.code === 'RATE_LIMIT_EXCEEDED') {
          throw new Error(errData.details || errData.error || '⚠️ AI provider is temporarily busy. Please wait a moment and try again.');
        }
        throw new Error(errData.details || errData.error || 'Analysis failed');
      }
      const data = await response.json();
      setResult(data);
      toast.success('Analysis Complete', `Found ${data.result?.rankedPartners?.length || 0} matching partners.`);
    } catch (error) {
      if (error.name === 'AbortError') {
        toast.error('Timeout', 'Server took too long to respond. Please try again.');
      } else {
        toast.error('Analysis Failed', error.message);
      }
    } finally {
      clearTimeout(warmupTimer);
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleDocumentAnalysis = async () => {
    if (!file) {
      toast.warning('No Document', 'Please upload a document first.');
      return;
    }
    setLoading(true);
    setResult(null);
    setLoadingMsg('Analyzing document...');
    const warmupTimer = setTimeout(() => setLoadingMsg('Server is warming up, please wait...'), 10000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
    try {
      const formData = new FormData();
      formData.append('document', file);
      const response = await fetch('/api/analyze/document', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      if (!response.ok) {
        const errData = await response.json();
        if (response.status === 503 || errData.code === 'RATE_LIMIT_EXCEEDED') {
          throw new Error(errData.details || errData.error || '⚠️ AI provider is temporarily busy. Please wait a moment and try again.');
        }
        throw new Error(errData.details || errData.error || 'Document analysis failed');
      }
      const data = await response.json();
      setResult(data);
      toast.success('Document Analysis Complete', `Extracted requirements and found ${data.result?.rankedPartners?.length || 0} matching partners.`);
    } catch (error) {
      if (error.name === 'AbortError') {
        toast.error('Timeout', 'Server took too long to respond. Please try again.');
      } else {
        toast.error('Document Analysis Failed', error.message);
      }
    } finally {
      clearTimeout(warmupTimer);
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const toggleCompareSelection = (partnerId) => {
    setSelectedForCompare(prev => {
      if (prev.includes(partnerId)) return prev.filter(id => id !== partnerId);
      if (prev.length >= 4) {
        toast.warning('Limit Reached', 'You can compare up to 4 partners at a time.');
        return prev;
      }
      return [...prev, partnerId];
    });
  };

  const handleExportPDF = async () => {
    if (!result?.id) return;
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: result.id }),
      });
      const data = await res.json();
      const { jsPDF } = await import('jspdf');
      await import('jspdf-autotable');
      const doc = new jsPDF();
      const report = data.report;

      // Title
      doc.setFontSize(18);
      doc.setTextColor(15, 23, 42);
      doc.text('Partnership Fitment Analysis Report', 14, 22);

      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString()}`, 14, 30);
      doc.text(`Analysis Type: ${report.analysisType}`, 14, 36);

      // Problem Summary
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('Problem Summary', 14, 48);
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      const summaryLines = doc.splitTextToSize(report.problemSummary || 'N/A', 180);
      doc.text(summaryLines, 14, 55);

      let yPos = 55 + summaryLines.length * 5 + 10;

      // Key Requirements
      if (report.keyRequirements?.length > 0) {
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('Key Requirements', 14, yPos);
        yPos += 7;
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        report.keyRequirements.forEach(req => {
          doc.text(`• ${req}`, 18, yPos);
          yPos += 5;
        });
        yPos += 5;
      }

      // Partner Rankings Table
      if (report.rankedPartners?.length > 0) {
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text('Ranked Partners', 14, yPos);
        yPos += 5;

        doc.autoTable({
          startY: yPos,
          head: [['Rank', 'Partner', 'Score', 'Assessment']],
          body: report.rankedPartners.map((p, i) => [
            i + 1,
            p.partnerName,
            p.fitmentScore,
            (p.overallAssessment || '').substring(0, 100) + '...'
          ]),
          theme: 'grid',
          headStyles: { fillColor: [15, 23, 42], fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          columnStyles: { 0: { cellWidth: 15 }, 2: { cellWidth: 20 } },
          margin: { left: 14, right: 14 },
        });
      }

      doc.save(`fitment-analysis-${result.id.slice(0, 8)}.pdf`);
      toast.success('PDF Downloaded', 'Report has been exported successfully.');
    } catch (error) {
      toast.error('Export Failed', error.message);
    }
  };

  const handleExportExcel = async () => {
    if (!result?.id) return;
    try {
      const res = await fetch('/api/export/excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: result.id }),
      });
      const data = await res.json();
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data.report.rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Fitment Analysis');
      XLSX.writeFile(wb, `fitment-analysis-${result.id.slice(0, 8)}.xlsx`);
      toast.success('Excel Downloaded', 'Report has been exported successfully.');
    } catch (error) {
      toast.error('Export Failed', error.message);
    }
  };

  return (
    <div>
      <BannerCard />

      {!result && !loading && (
        <>
          {/* Tabs */}
          <div className="tabs">
            <button className={`tab ${activeTab === 'text' ? 'active' : ''}`} onClick={() => setActiveTab('text')}>
              Describe Problem
            </button>
            <button className={`tab ${activeTab === 'document' ? 'active' : ''}`} onClick={() => setActiveTab('document')}>
              Upload Document
            </button>
          </div>

          {activeTab === 'text' && (
            <div className="card">
              <div className="form-group">
                <label className="form-label">Client Problem Description</label>
                <textarea
                  id="problem-text-input"
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  placeholder="Describe the client's business challenge, technical requirements, pain points, and desired outcomes. The more detail you provide, the more accurate the partner matching will be..."
                  rows={6}
                  style={{ minHeight: '160px' }}
                />
                <div className="form-hint">{problemText.length} characters — aim for 100+ for best results</div>
              </div>



              <div className="form-actions">
                <button id="analyze-btn" className="btn btn-primary btn-lg" onClick={handleTextAnalysis} disabled={loading}>
                  <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  Analyze & Find Partners
                </button>
              </div>
            </div>
          )}

          {activeTab === 'document' && (
            <div className="card">
              <div className="form-group">
                <label className="form-label">Upload RFP, SOW, or Requirements Document</label>
                <DocumentUpload onFileSelect={setFile} />
              </div>
              <div className="form-actions">
                <button id="analyze-doc-btn" className="btn btn-primary btn-lg" onClick={handleDocumentAnalysis} disabled={!file || loading}>
                  <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
                  </svg>
                  Extract & Analyze Document
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
          <LoadingState type="processing" />
          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: '0.9rem', animation: 'pulse 1.5s ease-in-out infinite' }}>
            {loadingMsg}
          </p>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div>
          {/* Result Header */}
          <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">Analysis Results</h3>
                <div className="card-subtitle">
                  {result.result?.rankedPartners?.length || 0} partners matched •{' '}
                  {new Date(result.timestamp).toLocaleString()}
                </div>
              </div>
              <div className="btn-group">
                <button className="btn btn-secondary btn-sm" onClick={handleExportPDF}>
                  <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd"/></svg>
                  Export PDF
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}>
                  <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                  Export Excel
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => { setResult(null); setSelectedForCompare([]); }}>
                  New Analysis
                </button>
              </div>
            </div>

            {/* Problem Summary */}
            {result.result?.problemSummary && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div className="fitment-card-section-title">Problem Summary</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  {result.result.problemSummary}
                </p>
              </div>
            )}

            {/* Key Requirements */}
            {result.result?.keyRequirements?.length > 0 && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div className="fitment-card-section-title">Key Requirements Identified</div>
                <div className="tags-list">
                  {result.result.keyRequirements.map((r, i) => (
                    <span key={i} className="tag">{r}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Document Extraction Summary */}
            {result.input?.extraction && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div className="fitment-card-section-title">Extracted from Document: {result.input.fileName}</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {result.input.extraction.summary}
                </p>
              </div>
            )}

            {result.result?.industryContext && (
              <div>
                <div className="fitment-card-section-title">Industry Context</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {result.result.industryContext}
                </p>
              </div>
            )}
          </div>

          {/* Partner Fitment Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {result.result?.rankedPartners?.map((partner, index) => (
              <FitmentCard
                key={partner.partnerId}
                partner={partner}
                rank={index + 1}
                onSelect={toggleCompareSelection}
                selected={selectedForCompare.includes(partner.partnerId)}
              />
            ))}
          </div>

          {/* Analysis Notes */}
          {result.result?.analysisNotes && (
            <div className="card" style={{ marginTop: 'var(--space-6)' }}>
              <div className="fitment-card-section-title">Strategic Notes</div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                {result.result.analysisNotes}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
