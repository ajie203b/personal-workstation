package com.personal.workstation;

import android.content.Context;
import android.util.AttributeSet;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;

import com.getcapacitor.CapacitorWebView;

/**
 * 安卓 WebView 自带的长按文本选择菜单（复制 / 全选 / 网页搜索 / 分享）会盖住
 * 阅读器自绘的高亮 / 转任务浮条。
 *
 * 不能等 ActionMode 创建完再 menu.clear()：那时浮动工具栏已经按旧菜单渲染好了。
 * 这里包一层 Callback，在 onCreate/onPrepare 里让 WebView 先填完菜单、立刻清空，
 * 工具栏拿到的是空菜单；选区手柄保留，复制等操作走网页侧浮条。
 */
public class SelectionWebView extends CapacitorWebView {

    public SelectionWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(stripCallback(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(stripCallback(callback), type);
    }

    private ActionMode.Callback stripCallback(ActionMode.Callback callback) {
        String url = getUrl();
        // 只接管阅读器（#/docs/:id）；编辑器和设置页保留系统复制/分享
        if (url == null || !url.contains("#/docs/") || url.contains("#/docs/edit/") || url.contains("#/docs/new")) {
            return callback;
        }
        return new ActionMode.Callback() {
            @Override
            public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                boolean ok = callback.onCreateActionMode(mode, menu);
                menu.clear();
                return ok;
            }

            @Override
            public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                boolean changed = callback.onPrepareActionMode(mode, menu);
                menu.clear();
                return changed;
            }

            @Override
            public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return callback.onActionItemClicked(mode, item);
            }

            @Override
            public void onDestroyActionMode(ActionMode mode) {
                callback.onDestroyActionMode(mode);
            }
        };
    }
}
